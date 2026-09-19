package com.selexiones.app;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "RadioPlayer")
public class RadioPlayerPlugin extends Plugin {

    @Override
    public void load() {
        super.load();
        RadioPlaybackService.setStatusListener(playing -> {
            JSObject data = new JSObject();
            data.put("playing", playing);
            notifyListeners("playbackStatus", data);
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
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
