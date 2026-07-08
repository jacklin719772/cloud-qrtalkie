package com.qrtalkie;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.widget.Toast;

public class NotificationActionReceiver extends BroadcastReceiver {

    public static final String ACTION_ACCEPT = "com.qrtalkie.ACTION_ACCEPT";
    public static final String ACTION_DECLINE = "com.qrtalkie.ACTION_DECLINE";
    public static final String EXTRA_NOTIFY_ID = "notify_id";

    @Override
    public void onReceive(Context context, Intent intent) {
        int notifyId = intent.getIntExtra(EXTRA_NOTIFY_ID, -1);

        if (ACTION_ACCEPT.equals(intent.getAction())) {
            Toast.makeText(context, "已接聽", Toast.LENGTH_SHORT).show();
        } else if (ACTION_DECLINE.equals(intent.getAction())) {
            Toast.makeText(context, "已拒絕", Toast.LENGTH_SHORT).show();
        }

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && notifyId != -1) {
            nm.cancel(notifyId);
        }
    }
}
