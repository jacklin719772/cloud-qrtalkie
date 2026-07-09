package com.qrtalkie;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.RemoteViews;

import cn.jpush.android.api.CustomMessage;
import cn.jpush.android.api.JPushInterface;
import cn.jpush.android.api.NotificationMessage;
import cn.jpush.android.service.JPushMessageReceiver;

public class MyPushMessageService extends JPushMessageReceiver {
    private static final String TAG = "MyReceiver";
    private static int sNotifyId = 1000;
    private final Handler mHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onMessage(Context context, CustomMessage customMessage) {
        Log.e(TAG, "[onMessage] " + customMessage);
        Intent intent = new Intent("com.jiguang.demo.message");
        intent.putExtra("msg", customMessage.message);
        context.sendBroadcast(intent);
    }

    @Override
    public void onNotifyMessageOpened(Context context, NotificationMessage notificationMessage) {
        super.onNotifyMessageOpened(context, notificationMessage);
        Log.e(TAG, "[onNotifyMessageOpened] " + notificationMessage);
    }

    @Override
    public void onNotifyMessageArrived(Context context, NotificationMessage msg) {
        super.onNotifyMessageArrived(context, msg);
        Log.e(TAG, "[onNotifyMessageArrived] " + msg);

        showCustomNotification(context, msg);
    }

    private void showCustomNotification(Context context, NotificationMessage msg) {
        String title = msg.notificationTitle != null ? msg.notificationTitle : "来電通知";
        String content = msg.notificationContent != null ? msg.notificationContent : "";

        int myNotifyId = ++sNotifyId;

        // 创建通知频道 (Android 8.0+ 必须)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                "MyChannelId",
                "來電通知",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("來電和訊息通知");
            channel.enableVibration(true);
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(channel);
        }

        RemoteViews remoteViews = new RemoteViews(context.getPackageName(), R.layout.customer_notification);
        remoteViews.setTextViewText(R.id.title, title);
        remoteViews.setTextViewText(R.id.text, content);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

        // Accept button
        Intent acceptIntent = new Intent(context, NotificationActionReceiver.class);
        acceptIntent.setAction(NotificationActionReceiver.ACTION_ACCEPT);
        acceptIntent.putExtra(NotificationActionReceiver.EXTRA_NOTIFY_ID, myNotifyId);
        PendingIntent acceptPi = PendingIntent.getBroadcast(context, myNotifyId, acceptIntent, flags);

        // Decline button
        Intent declineIntent = new Intent(context, NotificationActionReceiver.class);
        declineIntent.setAction(NotificationActionReceiver.ACTION_DECLINE);
        declineIntent.putExtra(NotificationActionReceiver.EXTRA_NOTIFY_ID, myNotifyId);
        PendingIntent declinePi = PendingIntent.getBroadcast(context, myNotifyId + 10000, declineIntent, flags);

        remoteViews.setOnClickPendingIntent(R.id.btn_accept, acceptPi);
        remoteViews.setOnClickPendingIntent(R.id.btn_decline, declinePi);

        // Full-screen intent: opens CallActivity that stays until user responds
        Intent fullScreenIntent = new Intent(context, CallActivity.class);
        fullScreenIntent.putExtra("notify_id", myNotifyId);
        fullScreenIntent.putExtra("title", title);
        fullScreenIntent.putExtra("content", content);
        fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent fullScreenPi = PendingIntent.getActivity(context, myNotifyId + 20000, fullScreenIntent, flags);

        Notification.Builder builder = new Notification.Builder(context, "MyChannelId")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setCustomContentView(remoteViews)
                .setCustomBigContentView(remoteViews)
                .setPriority(Notification.PRIORITY_MAX)
                .setCategory(Notification.CATEGORY_CALL)
                .setOngoing(true)
                .setAutoCancel(false)
                .setFullScreenIntent(fullScreenPi, true);

        Notification notification = builder.build();
        notification.flags |= Notification.FLAG_INSISTENT;

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(myNotifyId, notification);

            // Cancel JPush's default notification after a short delay
            mHandler.postDelayed(() -> {
                try {
                    nm.cancel(msg.notificationId);
                } catch (Exception ignored) {
                }
            }, 300);
        }
    }
}
