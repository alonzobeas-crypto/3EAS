package com.selexiones.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "RadioPlayer",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class RadioPlayerPlugin extends Plugin {

    @Override
    public void load() {
        super.load();
        RadioPlaybackService.setStatusListener(playing -> {
            JSObject data = new JSObject();
            data.put("playing", playing);
            notifyListeners("playbackStatus", data);
        });
        RadioPlaybackService.setNowPlayingListener((text, title, artist) -> {
            JSObject data = new JSObject();
            data.put("text", text);
            data.put("title", title);
            data.put("artist", artist);
            notifyListeners("nowPlaying", data);
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        // Android 13+ requires runtime consent to show the playback
        // notification. Playback itself doesn't depend on it — we start
        // either way, from the permission callback below.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermCallback");
            return;
        }
        startPlayback(call);
    }

    @PermissionCallback
    private void notificationPermCallback(PluginCall call) {
        startPlayback(call);
    }

    private void startPlayback(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("Missing url");
            return;
        }
        Intent intent = new Intent(getContext(), RadioPlaybackService.class);
        intent.setAction(RadioPlaybackService.ACTION_PLAY);
        intent.putExtra(RadioPlaybackService.EXTRA_URL, url);
        intent.putExtra(RadioPlaybackService.EXTRA_TITLE, call.getString("title", "SELEXIONES"));
        intent.putExtra(RadioPlaybackService.EXTRA_SUBTITLE, call.getString("subtitle", ""));
        intent.putExtra(RadioPlaybackService.EXTRA_NOW_PLAYING_URL, call.getString("nowPlayingUrl"));
        getContext().startForegroundService(intent);

        JSObject ret = new JSObject();
        ret.put("playing", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void pause(PluginCall call) {
        Intent intent = new Intent(getContext(), RadioPlaybackService.class);
        intent.setAction(RadioPlaybackService.ACTION_PAUSE);
        getContext().startForegroundService(intent);

        JSObject ret = new JSObject();
        ret.put("playing", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), RadioPlaybackService.class);
        intent.setAction(RadioPlaybackService.ACTION_STOP);
        getContext().startForegroundService(intent);

        JSObject ret = new JSObject();
        ret.put("playing", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        // Stream volume is left to the system volume controls on Android;
        // resolve so the JS side doesn't error waiting on this.
        call.resolve();
    }

    @PluginMethod
    public void setNowPlaying(PluginCall call) {
        call.resolve();
    }
}
