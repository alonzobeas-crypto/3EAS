import Foundation
import Capacitor
import AVFoundation
import MediaPlayer

@objc(RadioPlayerPlugin)
public class RadioPlayerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RadioPlayerPlugin"
    public let jsName = "RadioPlayer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNowPlaying", returnType: CAPPluginReturnPromise),
    ]

    private var player: AVPlayer?
    private var currentStreamURL: URL?
    private var currentTitle: String = "SELEXIONES"
    private var currentSubtitle: String = ""
    private var commandsConfigured = false
    private var wasPlayingBeforeInterruption = false

    // Now-playing polling — keeps lock-screen metadata live while backgrounded,
    // since the WKWebView's own JS timers get throttled/suspended in that state.
    private var nowPlayingTimer: Timer?
    private var nowPlayingURL: URL?
    private static let nowPlayingPollInterval: TimeInterval = 17.0 // matches CONFIG.nowPlayingPollMs in the web app

    // Stalled/failed playback retry, with backoff.
    private var retryCount = 0
    private let maxRetries = 5
    private var retryWorkItem: DispatchWorkItem?

    override public func load() {
        configureAudioSession()
        configureRemoteCommands()
        configureNotifications()
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true, options: [])
        } catch {
            print("RadioPlayer: failed to configure audio session: \(error)")
        }
    }

    private func configureNotifications() {
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(handleInterruption(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        center.addObserver(self, selector: #selector(handleRouteChange(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
        center.addObserver(self, selector: #selector(handlePlaybackStalled(_:)), name: .AVPlayerItemPlaybackStalled, object: nil)
        center.addObserver(self, selector: #selector(handleFailedToPlayToEnd(_:)), name: .AVPlayerItemFailedToPlayToEndTime, object: nil)
    }

    private func configureRemoteCommands() {
        guard !commandsConfigured else { return }
        commandsConfigured = true

        let center = MPRemoteCommandCenter.shared()

        center.playCommand.addTarget { [weak self] _ in
            guard let self = self, self.player != nil else { return .noActionableNowPlayingItem }
            self.player?.play()
            self.updatePlaybackState(playing: true)
            self.notifyListeners("playbackStatus", data: ["playing": true])
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            guard let self = self, self.player != nil else { return .noActionableNowPlayingItem }
            self.player?.pause()
            self.updatePlaybackState(playing: false)
            self.notifyListeners("playbackStatus", data: ["playing": false])
            return .success
        }
        center.stopCommand.addTarget { [weak self] _ in
            self?.teardownPlayer()
            self?.notifyListeners("playbackStatus", data: ["playing": false])
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self = self, let player = self.player else { return .noActionableNowPlayingItem }
            let playing = player.rate == 0
            playing ? player.play() : player.pause()
            self.updatePlaybackState(playing: playing)
            self.notifyListeners("playbackStatus", data: ["playing": playing])
            return .success
        }

        // Live radio has no timeline — disable every seek/skip affordance so
        // the lock screen doesn't show a scrubber or track-skip buttons.
        center.changePlaybackPositionCommand.isEnabled = false
        center.skipForwardCommand.isEnabled = false
        center.skipBackwardCommand.isEnabled = false
        center.nextTrackCommand.isEnabled = false
        center.previousTrackCommand.isEnabled = false
    }

    @objc func play(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("Missing or invalid url")
            return
        }
        currentTitle = call.getString("title") ?? currentTitle
        currentSubtitle = call.getString("subtitle") ?? currentSubtitle

        retryWorkItem?.cancel()
        retryCount = 0

        if player == nil || currentStreamURL != url {
            currentStreamURL = url
            player = AVPlayer(playerItem: AVPlayerItem(url: url))
        }
        player?.play()
        updateNowPlayingInfo()
        updatePlaybackState(playing: true)

        if let nowPlayingUrlString = call.getString("nowPlayingUrl"), let nowPlayingUrl = URL(string: nowPlayingUrlString) {
            startNowPlayingPolling(url: nowPlayingUrl)
        }

        call.resolve(["playing": true])
    }

    @objc func pause(_ call: CAPPluginCall) {
        retryWorkItem?.cancel()
        player?.pause()
        updatePlaybackState(playing: false)
        call.resolve(["playing": false])
    }

    @objc func stop(_ call: CAPPluginCall) {
        teardownPlayer()
        call.resolve(["playing": false])
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        let value = call.getFloat("value") ?? 1.0
        player?.volume = value
        call.resolve()
    }

    @objc func setNowPlaying(_ call: CAPPluginCall) {
        currentTitle = call.getString("title") ?? currentTitle
        currentSubtitle = call.getString("subtitle") ?? currentSubtitle
        updateNowPlayingInfo()
        call.resolve()
    }

    private func teardownPlayer() {
        retryWorkItem?.cancel()
        stopNowPlayingPolling()
        player?.pause()
        player = nil
        currentStreamURL = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    private func updateNowPlayingInfo() {
        var info: [String: Any] = [:]
        info[MPMediaItemPropertyTitle] = currentTitle
        info[MPMediaItemPropertyArtist] = currentSubtitle
        info[MPNowPlayingInfoPropertyIsLiveStream] = true
        info[MPNowPlayingInfoPropertyPlaybackRate] = player?.rate ?? 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func updatePlaybackState(playing: Bool) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    // MARK: - Now-playing polling

    private func startNowPlayingPolling(url: URL) {
        stopNowPlayingPolling()
        nowPlayingURL = url
        fetchNowPlaying(url: url)
        let timer = Timer(timeInterval: Self.nowPlayingPollInterval, repeats: true) { [weak self] _ in
            self?.fetchNowPlaying(url: url)
        }
        RunLoop.main.add(timer, forMode: .common)
        nowPlayingTimer = timer
    }

    private func stopNowPlayingPolling() {
        nowPlayingTimer?.invalidate()
        nowPlayingTimer = nil
        nowPlayingURL = nil
    }

    private func fetchNowPlaying(url: URL) {
        let task = URLSession.shared.dataTask(with: url) { [weak self] data, _, error in
            guard let self = self, let data = data, error == nil else { return }
            guard
                let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let nowPlaying = json["now_playing"] as? [String: Any],
                let song = nowPlaying["song"] as? [String: Any]
            else { return }

            let title = (song["title"] as? String) ?? ""
            let artist = (song["artist"] as? String) ?? ""
            let text = (song["text"] as? String) ?? [artist, title].filter { !$0.isEmpty }.joined(separator: " - ")

            DispatchQueue.main.async {
                self.currentSubtitle = text
                self.updateNowPlayingInfo()
                self.notifyListeners("nowPlaying", data: ["text": text, "title": title, "artist": artist])
            }
        }
        task.resume()
    }

    // MARK: - Interruptions / route changes

    @objc private func handleInterruption(_ notification: Notification) {
        guard
            let info = notification.userInfo,
            let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: typeValue)
        else { return }

        switch type {
        case .began:
            wasPlayingBeforeInterruption = (player?.rate ?? 0) > 0
            player?.pause()
            updatePlaybackState(playing: false)
            notifyListeners("playbackStatus", data: ["playing": false])
        case .ended:
            var shouldResume = wasPlayingBeforeInterruption
            if let optionsValue = info[AVAudioSessionInterruptionOptionKey] as? UInt {
                shouldResume = shouldResume && AVAudioSession.InterruptionOptions(rawValue: optionsValue).contains(.shouldResume)
            }
            if shouldResume {
                try? AVAudioSession.sharedInstance().setActive(true)
                player?.play()
                updatePlaybackState(playing: true)
                notifyListeners("playbackStatus", data: ["playing": true])
            }
        @unknown default:
            break
        }
    }

    @objc private func handleRouteChange(_ notification: Notification) {
        guard
            let info = notification.userInfo,
            let reasonValue = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
            let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue)
        else { return }

        // Headphones/Bluetooth output disconnected — pause, matching the
        // standard behavior of every system media app.
        if reason == .oldDeviceUnavailable, (player?.rate ?? 0) > 0 {
            player?.pause()
            updatePlaybackState(playing: false)
            notifyListeners("playbackStatus", data: ["playing": false])
        }
    }

    // MARK: - Stall / failure retry

    @objc private func handlePlaybackStalled(_ notification: Notification) {
        scheduleRetry()
    }

    @objc private func handleFailedToPlayToEnd(_ notification: Notification) {
        scheduleRetry()
    }

    private func scheduleRetry() {
        guard retryCount < maxRetries, let url = currentStreamURL else { return }
        retryWorkItem?.cancel()

        let delay = min(pow(2.0, Double(retryCount)), 30.0)
        retryCount += 1

        let workItem = DispatchWorkItem { [weak self] in
            guard let self = self, let url = self.currentStreamURL else { return }
            self.player = AVPlayer(playerItem: AVPlayerItem(url: url))
            self.player?.play()
            self.updatePlaybackState(playing: true)
            self.notifyListeners("playbackStatus", data: ["playing": true])
        }
        retryWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
    }
}
