package com.selexiones.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * Foreground service that owns the actual audio playback, so the stream keeps
 * running (and stays controllable from the lock screen / notification shade)
 * when the app is backgrounded — something a WebView &lt;audio&gt; element
 * cannot reliably do. Also owns audio-focus handling, the "becoming noisy"
 * (headphones unplugged) pause, now-playing metadata polling, and retrying
 * playback when connectivity returns.
 */
public class RadioPlaybackService extends Service {
    public static final String ACTION_PLAY = "com.selexiones.app.action.PLAY";
    public static final String ACTION_PAUSE = "com.selexiones.app.action.PAUSE";
    public static final String ACTION_STOP = "com.selexiones.app.action.STOP";
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_SUBTITLE = "subtitle";
    public static final String EXTRA_NOW_PLAYING_URL = "nowPlayingUrl";

    private static final String CHANNEL_ID = "selexiones_playback";
    private static final int NOTIFICATION_ID = 1;
    private static final long NOW_PLAYING_POLL_MS = 17000; // matches CONFIG.nowPlayingPollMs in the web app

    public interface StatusListener {
        void onStatusChanged(boolean playing);
    }

    public interface NowPlayingListener {
        void onNowPlaying(String text, String title, String artist);
    }

    private static RadioPlaybackService instance;
    private static StatusListener statusListener;
    private static NowPlayingListener nowPlayingListener;

    public static void setStatusListener(StatusListener listener) {
        statusListener = listener;
    }

    public static void setNowPlayingListener(NowPlayingListener listener) {
        nowPlayingListener = listener;
    }

    public static boolean isPlaying() {
        return instance != null && instance.player != null && instance.player.isPlaying();
    }

    private MediaPlayer player;
    private MediaSessionCompat mediaSession;
    private AudioManager audioManager;
    private ConnectivityManager connectivityManager;
    private AudioFocusRequest focusRequest; // API 26+
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();

    private String title = "SELEXIONES";
    private String subtitle = "";
    private String lastUrl;
    private String nowPlayingUrl;
    private boolean intendedToPlay = false;
    private Runnable nowPlayingRunnable;

    private final IBinder binder = new LocalBinder();

    public class LocalBinder extends android.os.Binder {
        RadioPlaybackService getService() {
            return RadioPlaybackService.this;
        }
    }

    private final AudioManager.OnAudioFocusChangeListener focusListener = focusChange -> {
        switch (focusChange) {
            case AudioManager.AUDIOFOCUS_LOSS:
                intendedToPlay = false;
                pauseInternal();
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                // Leave intendedToPlay true — AUDIOFOCUS_GAIN below resumes it.
                pauseInternal();
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                if (player != null) player.setVolume(0.2f, 0.2f);
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                if (player != null) player.setVolume(1f, 1f);
                if (intendedToPlay && player != null && !player.isPlaying()) resumeInternal();
                break;
        }
    };

    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                // Headphones/Bluetooth output disconnected — pause rather than
                // surprise the room by switching to the speaker.
                pauseInternal();
            }
        }
    };

    private ConnectivityManager.NetworkCallback networkCallback;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();

        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);

        registerReceiver(noisyReceiver, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
        registerNetworkCallback();

        mediaSession = new MediaSessionCompat(this, "SelexionesSession");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                intendedToPlay = true;
                resumeInternal();
            }

            @Override
            public void onPause() {
                pauseInternal();
            }

            @Override
            public void onStop() {
                stopSelf();
            }
        });
        mediaSession.setActive(true);
    }

    private void registerNetworkCallback() {
        NetworkRequest request = new NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build();
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                if (intendedToPlay && lastUrl != null && (player == null || !player.isPlaying())) {
                    mainHandler.post(() -> startPlayback(lastUrl));
                }
            }
        };
        try {
            connectivityManager.registerNetworkCallback(request, networkCallback);
        } catch (Exception e) {
            // Some OEM ROMs restrict this — playback still works, it just
            // won't auto-retry the instant connectivity returns.
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        String action = intent.getAction();
        if (ACTION_PLAY.equals(action)) {
            String url = intent.getStringExtra(EXTRA_URL);
            title = intent.getStringExtra(EXTRA_TITLE) != null ? intent.getStringExtra(EXTRA_TITLE) : title;
            subtitle = intent.getStringExtra(EXTRA_SUBTITLE) != null ? intent.getStringExtra(EXTRA_SUBTITLE) : "";
            nowPlayingUrl = intent.getStringExtra(EXTRA_NOW_PLAYING_URL);
            intendedToPlay = true;
            if (url != null) {
                startPlayback(url);
            } else {
                resumeInternal();
            }
        } else if (ACTION_PAUSE.equals(action)) {
            intendedToPlay = false;
            pauseInternal();
        } else if (ACTION_STOP.equals(action)) {
            intendedToPlay = false;
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void startPlayback(String url) {
        if (!requestAudioFocus()) {
            onPlaybackChanged(false);
            return;
        }
        lastUrl = url;
        try {
            releasePlayer();
            player = new MediaPlayer();
            player.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            );
            player.setDataSource(url);
            player.setOnPreparedListener(mp -> {
                mp.start();
                onPlaybackChanged(true);
                startNowPlayingPolling();
            });
            player.setOnErrorListener((mp, what, extra) -> {
                onPlaybackChanged(false);
                return true;
            });
            player.prepareAsync();
        } catch (IOException e) {
            onPlaybackChanged(false);
        }
    }

    private void resumeInternal() {
        if (!requestAudioFocus()) return;
        if (player != null && !player.isPlaying()) {
            player.start();
            onPlaybackChanged(true);
            startNowPlayingPolling();
        } else if (player == null && lastUrl != null) {
            startPlayback(lastUrl);
        }
    }

    private void pauseInternal() {
        if (player != null && player.isPlaying()) {
            player.pause();
            onPlaybackChanged(false);
        }
        stopNowPlayingPolling();
    }

    private boolean requestAudioFocus() {
        if (audioManager == null) return true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build();
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener(focusListener, mainHandler)
                .build();
            return audioManager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } else {
            return audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
                == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
    }

    private void abandonAudioFocus() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest != null) audioManager.abandonAudioFocusRequest(focusRequest);
        } else {
            audioManager.abandonAudioFocus(focusListener);
        }
    }

    private void releasePlayer() {
        if (player != null) {
            try {
                player.stop();
            } catch (IllegalStateException ignored) {
            }
            player.release();
            player = null;
        }
    }

    private void onPlaybackChanged(boolean playing) {
        int state = playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
        mediaSession.setPlaybackState(
            new PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_STOP)
                .setState(state, 0, 1f)
                .build()
        );
        startForeground(NOTIFICATION_ID, buildNotification(playing));
        if (statusListener != null) {
            statusListener.onStatusChanged(playing);
        }
        if (!playing) {
            abandonAudioFocus();
        }
    }

    private Notification buildNotification(boolean playing) {
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 0,
            new Intent(this, MainActivity.class),
            PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title)
            .setContentText(subtitle)
            .setContentIntent(contentIntent)
            .setOngoing(playing)
            .setStyle(new MediaStyle().setMediaSession(mediaSession.getSessionToken()))
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "SELEXIONES playback", NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Now playing controls for SELEXIONES radio");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    // MARK: - Now-playing polling

    private void startNowPlayingPolling() {
        stopNowPlayingPolling();
        if (nowPlayingUrl == null) return;
        nowPlayingRunnable = new Runnable() {
            @Override
            public void run() {
                fetchNowPlaying(nowPlayingUrl);
                mainHandler.postDelayed(this, NOW_PLAYING_POLL_MS);
            }
        };
        mainHandler.post(nowPlayingRunnable);
    }

    private void stopNowPlayingPolling() {
        if (nowPlayingRunnable != null) {
            mainHandler.removeCallbacks(nowPlayingRunnable);
            nowPlayingRunnable = null;
        }
    }

    private void fetchNowPlaying(String urlString) {
        networkExecutor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(urlString);
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                InputStream is = conn.getInputStream();
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                int n;
                while ((n = is.read(buf)) != -1) bos.write(buf, 0, n);
                is.close();

                JSONObject root = new JSONObject(bos.toString("UTF-8"));
                JSONObject nowPlaying = root.optJSONObject("now_playing");
                if (nowPlaying == null) return;
                JSONObject song = nowPlaying.optJSONObject("song");
                if (song == null) return;

                String songTitle = song.optString("title", "");
                String artist = song.optString("artist", "");
                String defaultText = artist.isEmpty() || songTitle.isEmpty()
                    ? (artist + songTitle)
                    : artist + " - " + songTitle;
                String text = song.optString("text", defaultText);

                mainHandler.post(() -> {
                    subtitle = text;
                    mediaSession.setMetadata(
                        new MediaMetadataCompat.Builder()
                            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, text)
                            .build()
                    );
                    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                    if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification(player != null && player.isPlaying()));
                    if (nowPlayingListener != null) nowPlayingListener.onNowPlaying(text, songTitle, artist);
                });
            } catch (Exception e) {
                // A missed poll isn't worth crashing the service over.
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onDestroy() {
        stopNowPlayingPolling();
        networkExecutor.shutdownNow();
        try {
            unregisterReceiver(noisyReceiver);
        } catch (IllegalArgumentException ignored) {
        }
        if (networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (Exception ignored) {
            }
        }
        abandonAudioFocus();
        releasePlayer();
        mediaSession.release();
        instance = null;
        super.onDestroy();
    }
}
