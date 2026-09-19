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
    private var currentTitle: String = "SELEXIONES"
    private var currentSubtitle: String = ""
    private var commandsConfigured = false

    override public func load() {
        configureAudioSession()
        configureRemoteCommands()
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
    }

    @objc func play(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("Missing or invalid url")
            return
        }
        currentTitle = call.getString("title") ?? currentTitle
        currentSubtitle = call.getString("subtitle") ?? ""

        let currentURL = (player?.currentItem?.asset as? AVURLAsset)?.url
        if player == nil || currentURL != url {
            player = AVPlayer(playerItem: AVPlayerItem(url: url))
        }
        player?.play()
        updateNowPlayingInfo()
        updatePlaybackState(playing: true)
        call.resolve(["playing": true])
    }

    @objc func pause(_ call: CAPPluginCall) {
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
        player?.pause()
        player = nil
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
}
