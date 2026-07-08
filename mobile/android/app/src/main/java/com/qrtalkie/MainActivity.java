package com.qrtalkie;

import androidx.appcompat.app.AppCompatActivity;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.ImageButton;
import android.widget.TextView;

import com.qrtalkie.R;
import com.qrtalkie.utils.ExampleUtil;

import cn.jpush.android.api.JPushInterface;

public class MainActivity extends AppCompatActivity implements View.OnClickListener {

    private TextView tvRegID;
    private ImageButton btnPush;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        initView();
    }

    private void initView(){
        btnPush  = findViewById(R.id.btn_push);
        btnPush.setOnClickListener(this);
        TextView tvPackageName = findViewById(R.id.tv_package_name);
        tvPackageName.setText(this.getApplicationContext().getPackageName());

        TextView tvAppKey = findViewById(R.id.tv_app_key);
        tvAppKey.setText(ExampleUtil.getAppKey(this.getApplicationContext()));

        TextView tvAppChannel = findViewById(R.id.tv_app_channel);
        tvAppChannel.setText(ExampleUtil.getAppChannel(this.getApplicationContext()));

        tvRegID = findViewById(R.id.tv_rid);
        // 延迟获取regID
        Thread thread = new Thread(){
            @Override
            public void run() {
                super.run();
                try {
                    Thread.sleep(2000);
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            tvRegID.setText(JPushInterface.getRegistrationID(getApplicationContext()));
                        }
                    });
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            }
        };
        thread.start();

        isStatus();
    }

    @Override
    public void onClick(View v) {
        int id = v.getId();
        if (id == R.id.btn_push){
            JPushInterface.setBadgeNumber(this,0);
            JPushInterface.goToAppNotificationSettings(this.getApplicationContext());
        }
    }

    // 判断通知权限开关状态
    private void isStatus(){
        int status = JPushInterface.isNotificationEnabled(this.getApplicationContext());
        TextView tvNotification = findViewById(R.id.tv_notification);
        switch (status){
            case 1:
                tvNotification.setText("开启");
                break;
            case 0:
                tvNotification.setText("关闭");
                break;
            case -1:
                tvNotification.setText("检测失败，请手动检查开关状态是否开启");
                break;
            default:
                break;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        isStatus();
    }
}