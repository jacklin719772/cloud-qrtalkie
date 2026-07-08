package com.qrtalkie;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

public class CallActivity extends Activity {

    private int mNotifyId;
    private NotificationManager mNm;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Show even on lock screen
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_FULLSCREEN);

        setContentView(R.layout.activity_call);

        mNotifyId = getIntent().getIntExtra("notify_id", -1);
        mNm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);

        String title = getIntent().getStringExtra("title");
        String content = getIntent().getStringExtra("content");

        TextView tvTitle = findViewById(R.id.tv_call_title);
        tvTitle.setText(title != null ? title : "来電通知");

        TextView tvContent = findViewById(R.id.tv_call_content);
        tvContent.setText(content != null ? content : "");

        Button btnAccept = findViewById(R.id.btn_call_accept);
        btnAccept.setOnClickListener(v -> {
            if (mNotifyId != -1) mNm.cancel(mNotifyId);
            finish();
        });

        Button btnDecline = findViewById(R.id.btn_call_decline);
        btnDecline.setOnClickListener(v -> {
            if (mNotifyId != -1) mNm.cancel(mNotifyId);
            finish();
        });
    }

    @Override
    public void onBackPressed() {
        // Block back button - must use Accept or Decline
    }
}
