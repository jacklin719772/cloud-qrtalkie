package com.qrtalkie;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationChannelGroup;
import android.app.NotificationManager;
import android.content.Context;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.media.RingtoneManager;
import android.os.Build;
import android.support.multidex.MultiDex;
import android.util.DisplayMetrics;

import cn.jiguang.api.JCoreInterface;
import cn.jiguang.internal.JConstants;
import cn.jpush.android.api.JPushInterface;

public class MyApp extends Application {

    @Override
    protected void attachBaseContext(Context base) {
        super.attachBaseContext(base);
        MultiDex.install(this);
    }


    @Override
    public void onCreate() {
        super.onCreate();
        JCoreInterface.setDebugMode(true);
        JConstants.CMD_TO_PRINT_ALL_LOG=true;

        initChannel();
        JPushInterface.init(this);

        fixFontScale(getResources());
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // 当系统字体设置发生变化时，强制设置默认字体缩放
        if (newConfig.fontScale != 1.0f) {
            fixFontScale(getResources());
        }
    }

    private void fixFontScale(Resources resources) {
        Configuration configuration = resources.getConfiguration();
        if (configuration.fontScale != 1.0f) {
            configuration.fontScale = 1.0f;
            DisplayMetrics metrics = resources.getDisplayMetrics();
            resources.updateConfiguration(configuration, metrics);
        }
    }

    private void initChannel(){
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null){
                NotificationChannelGroup notificationChannelGroup = new NotificationChannelGroup("MyGroupId", "自定义通知组");
                nm.createNotificationChannelGroup(notificationChannelGroup);

                NotificationChannel notificationChannel = new NotificationChannel("MyChannelId", "自定义通知", NotificationManager.IMPORTANCE_HIGH);
                notificationChannel.setGroup("MyGroupId");
                notificationChannel.enableLights(true);
                notificationChannel.enableVibration(true);
                notificationChannel.setVibrationPattern(new long[]{0, 500, 500, 500});
                notificationChannel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), null);

                nm.createNotificationChannel(notificationChannel);
            }
        }
    }



}
