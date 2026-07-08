package com.qrtalkie.utils;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.ServiceInfo;
import android.text.TextUtils;
import android.util.Log;

import java.util.List;

public class ExampleUtil {

    private static final String TAG = "ExampleUtil";

    private static final String APP_KEY = "JPUSH_APPKEY";
    private static final String APP_CHANNEL = "JPUSH_CHANNEL";

    private static String appKey;
    private static String appChannel;

    private static int appVersionCode;
    private static String appVersionName;

    public static String getAppVersionName(Context context) {
        if (!TextUtils.isEmpty(appVersionName)) {
            return appVersionName;
        }
        try {
            PackageManager manager = context.getPackageManager();
            PackageInfo info = manager.getPackageInfo(context.getPackageName(), 0);
            appVersionName = info.versionName;
            return appVersionName;
        } catch (Throwable throwable) {
            Log.w(TAG, "getAppVersionName failed: " + throwable.getMessage());
        }
        return "";
    }

    public static int getAppVersionCode(Context context) {
        if (appVersionCode != 0) {
            return appVersionCode;
        }
        try {
            PackageManager manager = context.getPackageManager();
            PackageInfo info = manager.getPackageInfo(context.getPackageName(), 0);
            appVersionCode = info.versionCode;
            return appVersionCode;
        } catch (Throwable throwable) {
            Log.w(TAG, "getAppVersionCode failed: " + throwable.getMessage());
        }
        return 0;
    }

    public static String getAppKey(Context context) {
        if (TextUtils.isEmpty(appKey)) {
            appKey = getMetaData(context, APP_KEY);
        }
        return appKey;
    }

    public static String getAppChannel(Context context) {
        if (TextUtils.isEmpty(appChannel)) {
            appChannel = getMetaData(context, APP_CHANNEL);
        }
        return appChannel;
    }


    public static String getMetaData(Context context, String metaDataName) {
        try {
            ApplicationInfo info = context.getPackageManager().getApplicationInfo(context.getPackageName(), PackageManager.GET_META_DATA);
            if (info != null && info.metaData != null) {
                return String.valueOf(info.metaData.get(metaDataName));
            }
        } catch (Throwable throwable) {
            Log.w(TAG, "getMetaData failed " + throwable.getMessage());
        }
        return "";
    }
}
