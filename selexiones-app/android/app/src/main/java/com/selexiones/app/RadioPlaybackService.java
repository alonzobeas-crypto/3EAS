package com.selexiones.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.IBinder;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import java.io.IOException;

/**
 * Foreground service that owns the actual audio playback, so the stream keeps
 * running (and stays controllable from the lock screen / notification shade)
 * when the app is backgrounded — something a WebView &lt;audio&gt; element
 * cannot reliably do.
 */
public class RadioPlaybackService extends Service {
    public static final String ACTION_PLAY = "com.selexiones.app.action.PLAY";
    public static final String ACTION_PAUSE = "com.selexiones.app.action.PAUSE";
    public static final String ACTION_STOP = "com.selexiones.app.action.STOP";
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_SUBTITLE = "subtitle";

    private static final String CHANNEL_ID = "selexiones_playback";
    private static final int NOTIFICATION_ID = 1;

    public interface StatusListener {
        void onStatusChanged(boolean playing);
    }

    private static RadioPlaybackService instance;
    private static StatusListener statusListener;

    public static void setStatusListener(StatusListener listener) {
        statusListener = listener;
    }

    public static boolean isPlaying() {
        return instance != null && instance.player != null && instance.player.isPlaying();
    }

    private MediaPlayer player;
    private MediaSessionCompat mediaSession;
    private String title = "SELEXIONES";
    private String subtitle = "";
    private final IBinder binder = new LocalBinder();

    public class LocalBinder extends android.os.Binder {
        RadioPlaybackService getService() {
            return RadioPlaybackService.this;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();

        mediaSession = new MediaSessionCompat(this, "SelexionesSession");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                resume();
            }

            @Override
            public void onPause() {
                pause();
            }

            @Override
            public void onStop() {
                stopSelf();
            }
        });
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        String action = intent.getAction();
        if (ACTION_PLAY.equals(action)) {
            String url = intent.getStringExtra(EXTRA_URL);
            title = intent.getStringExtra(EXTRA_TITLE) != null ? intent.getStringExtra(EXTRA_TITLE) : title;
            subtitle = intent.getStringExtra(EXTRA_SUBTITLE) != null ? intent.getStringExtra(EXTRA_SUBTITLE) : "";
            if (url != null) {
                play(url);
            } else {
                resume();
            }
        } else if (ACTION_PAUSE.equals(action)) {
            pause();
        } else if (ACTION_STOP.equals(action)) {
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void play(String url) {
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

    private void resume() {
        if (player != null && !player.isPlaying()) {
            player.start();
            onPlaybackChanged(true);
        }
    }

    private void pause() {
        if (player != null && player.isPlaying()) {
            player.pause();
            onPlaybackChanged(false);
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

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onDestroy() {
        releasePlayer();
        mediaSession.release();
        instance = null;
        super.onDestroy();
    }
}
