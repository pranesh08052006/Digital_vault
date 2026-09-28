import os
import sys
import shutil
import subprocess
import zipfile
from pathlib import Path
from PIL import Image

BASE_DIR = Path(r"D:\Monesh\Digital Vault")
BUILD_DIR = BASE_DIR / "android-build"
SRC_DIR = BUILD_DIR / "src" / "main"
JAVA_SRC_DIR = SRC_DIR / "java" / "com" / "digitalvault" / "app"
RES_DIR = SRC_DIR / "res"
ASSETS_DIR = SRC_DIR / "assets"
OBJ_DIR = BUILD_DIR / "obj"
GEN_DIR = BUILD_DIR / "gen"
DIST_DIR = BASE_DIR / "release"
KEYSTORE_DIR = BASE_DIR / "keystore"

JDK_BIN = Path(r"C:\Program Files\Java\jdk-25.0.2\bin")
JAVAC = JDK_BIN / "javac.exe"
KEYTOOL = JDK_BIN / "keytool.exe"

SDK_ROOT = Path(os.environ.get("LOCALAPPDATA", r"C:\Users\prane\AppData\Local")) / "Android" / "Sdk"
BUILD_TOOLS = SDK_ROOT / "build-tools" / "35.0.0"
AAPT2 = BUILD_TOOLS / "aapt2.exe"
D8 = BUILD_TOOLS / "d8.bat"
ZIPALIGN = BUILD_TOOLS / "zipalign.exe"
APKSIGNER = BUILD_TOOLS / "apksigner.bat"
ANDROID_JAR = SDK_ROOT / "platforms" / "android-34" / "android.jar"
if not ANDROID_JAR.exists():
    ANDROID_JAR = SDK_ROOT / "platforms" / "android-35" / "android.jar"

print(f"Using Android JAR: {ANDROID_JAR}")
print(f"Using AAPT2: {AAPT2}")
print(f"Using D8: {D8}")
print(f"Using JAVAC: {JAVAC}")

# 1. Clean and setup directories (Preserving persistent keystore directory!)
if BUILD_DIR.exists():
    shutil.rmtree(BUILD_DIR)
for d in [JAVA_SRC_DIR, RES_DIR / "values", RES_DIR / "xml", RES_DIR / "layout", ASSETS_DIR, OBJ_DIR, GEN_DIR, DIST_DIR, KEYSTORE_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# 2. Generate AndroidManifest.xml
manifest_content = """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.digitalvault.app"
    android:versionCode="3"
    android:versionName="1.0.2">

    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="34" />

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher"
        android:supportsRtl="true"
        android:hardwareAccelerated="true"
        android:networkSecurityConfig="@xml/network_security_config"
        android:usesCleartextTraffic="true"
        android:theme="@style/AppTheme">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTask"
            android:configChanges="orientation|screenSize|keyboardHidden|screenLayout"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

            <!-- Deep link handler for Google OAuth redirect callback -->
            <intent-filter android:autoVerify="false">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="digitalvault" android:host="auth" />
            </intent-filter>
        </activity>

    </application>
</manifest>
"""
(SRC_DIR / "AndroidManifest.xml").write_text(manifest_content.strip(), encoding="utf-8")

# 3. Generate res/values/strings.xml
strings_content = """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Digital Vault</string>
</resources>
"""
(RES_DIR / "values" / "strings.xml").write_text(strings_content.strip(), encoding="utf-8")

# 4. Generate res/values/colors.xml
colors_content = """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="primary">#0b0f17</color>
    <color name="primary_dark">#06080d</color>
    <color name="accent">#38bdf8</color>
</resources>
"""
(RES_DIR / "values" / "colors.xml").write_text(colors_content.strip(), encoding="utf-8")

# 5. Generate res/values/styles.xml
styles_content = """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="@android:style/Theme.DeviceDefault.NoActionBar">
        <item name="android:statusBarColor">#0b0f17</item>
        <item name="android:navigationBarColor">#0b0f17</item>
        <item name="android:windowBackground">#0b0f17</item>
    </style>
</resources>
"""
(RES_DIR / "values" / "styles.xml").write_text(styles_content.strip(), encoding="utf-8")

# 6. Generate res/xml/network_security_config.xml
network_config = """<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </base-config>
</network-security-config>
"""
(RES_DIR / "xml" / "network_security_config.xml").write_text(network_config.strip(), encoding="utf-8")

# 7. Generate res/layout/activity_main.xml
layout_content = """<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#0b0f17">

    <WebView
        android:id="@+id/webview"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:background="#0b0f17" />

</FrameLayout>
"""
(RES_DIR / "layout" / "activity_main.xml").write_text(layout_content.strip(), encoding="utf-8")

# 8. Generate launcher icons from assets/cloud_logo.jpg
logo_path = BASE_DIR / "assets" / "cloud_logo.jpg"
sizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
if logo_path.exists():
    img = Image.open(logo_path).convert("RGBA")
    for folder, size in sizes.items():
        icon_folder = RES_DIR / folder
        icon_folder.mkdir(parents=True, exist_ok=True)
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(icon_folder / "ic_launcher.png", "PNG")
    print("Created launcher icons.")

def load_env():
    env_vars = {}
    env_file = BASE_DIR / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                env_vars[key.strip()] = val.strip().strip("'\"")
    return env_vars

ENV_VARS = load_env()
BACKEND_URL = (os.environ.get("BACKEND_URL") or ENV_VARS.get("BACKEND_URL") or ENV_VARS.get("API_BASE_URL") or "").rstrip("/")
print(f"Configured Build Backend URL: {BACKEND_URL if BACKEND_URL else '(None / Local development)'}")

# 9. Generate MainActivity.java
java_content = f"""package com.digitalvault.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public class MainActivity extends Activity {{

    private WebView mWebView;
    private ValueCallback<Uri[]> mUploadMessage;
    private final static int FILECHOOSER_RESULTCODE = 1001;
    private SharedPreferences mPrefs;
    private final static String DEFAULT_BACKEND_URL = "{BACKEND_URL}";

    public static class AndroidBridge {{
        private final Context mContext;
        private final SharedPreferences mPrefs;

        public AndroidBridge(Context context, SharedPreferences prefs) {{
            this.mContext = context;
            this.mPrefs = prefs;
        }}

        @JavascriptInterface
        public void showToast(String message) {{
            Toast.makeText(mContext, message, Toast.LENGTH_SHORT).show();
        }}

        @JavascriptInterface
        public String getPlatform() {{
            return "android";
        }}

        @JavascriptInterface
        public String getServerUrl() {{
            String saved = mPrefs.getString("server_url", "");
            if (saved != null && !saved.trim().isEmpty()) {{
                return saved.trim();
            }}
            return DEFAULT_BACKEND_URL;
        }}

        @JavascriptInterface
        public void setServerUrl(String url) {{
            mPrefs.edit().putString("server_url", url != null ? url.trim() : "").apply();
        }}

        @JavascriptInterface
        public void openExternalUrl(String url) {{
            try {{
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                mContext.startActivity(intent);
            }} catch (Exception e) {{
                Toast.makeText(mContext, "Could not open link: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            }}
        }}
    }}

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {{
        super.onCreate(savedInstanceState);

        mPrefs = getSharedPreferences("digital_vault_prefs", MODE_PRIVATE);

        // Customize status bar color
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {{
            Window window = getWindow();
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.parseColor("#0b0f17"));
            window.setNavigationBarColor(Color.parseColor("#0b0f17"));
        }}

        setContentView(R.layout.activity_main);

        mWebView = findViewById(R.id.webview);
        mWebView.setBackgroundColor(Color.parseColor("#0b0f17"));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {{
            WebView.setWebContentsDebuggingEnabled(true);
        }}

        WebSettings settings = mWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(false);
        settings.setLoadWithOverviewMode(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        mWebView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        mWebView.setVerticalScrollBarEnabled(false);
        mWebView.setHorizontalScrollBarEnabled(false);

        // Standard mobile User-Agent
        String customUA = settings.getUserAgentString();
        if (customUA != null) {{
            customUA = customUA.replace("; wv", "");
            settings.setUserAgentString(customUA);
        }}

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {{
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }}

        mWebView.addJavascriptInterface(new AndroidBridge(this, mPrefs), "AndroidBridge");

        mWebView.setWebViewClient(new WebViewClient() {{
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {{
                String url = request.getUrl().toString();
                if (url.startsWith("file://") || url.contains("/api/")) {{
                    return false;
                }}
                if (url.startsWith("digitalvault://")) {{
                    handleDeepLink(url);
                    return true;
                }}
                if (url.startsWith("https://accounts.google.com") || url.startsWith("https://apis.google.com")) {{
                    // Open Google OAuth in external system browser for secure authentication
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                    return true;
                }}
                return false;
            }}

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {{
                super.onPageStarted(view, url, favicon);
            }}

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {{
                super.onReceivedError(view, request, error);
            }}
        }});

        mWebView.setWebChromeClient(new WebChromeClient() {{
            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {{
                return super.onConsoleMessage(consoleMessage);
            }}

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback,
                                            WebChromeClient.FileChooserParams fileChooserParams) {{
                if (mUploadMessage != null) {{
                    mUploadMessage.onReceiveValue(null);
                }}
                mUploadMessage = filePathCallback;

                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                startActivityForResult(Intent.createChooser(intent, "Select File"), FILECHOOSER_RESULTCODE);
                return true;
            }}
        }});

        mWebView.loadUrl("file:///android_asset/index.html");

        handleIntent(getIntent());
    }}

    @Override
    protected void onNewIntent(Intent intent) {{
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }}

    private void handleIntent(Intent intent) {{
        if (intent != null && intent.getData() != null) {{
            String uriString = intent.getData().toString();
            if (uriString.startsWith("digitalvault://")) {{
                handleDeepLink(uriString);
            }}
        }}
    }}

    private void handleDeepLink(String url) {{
        Toast.makeText(this, "Google Account connected successfully!", Toast.LENGTH_SHORT).show();
        if (mWebView != null) {{
            final String deepLink = url;
            mWebView.post(new Runnable() {{
                @Override
                public void run() {{
                    mWebView.evaluateJavascript("if (typeof handleDeepLinkAuth === 'function') {{ handleDeepLinkAuth('" + deepLink + "'); }} else if (typeof checkAuthStatus === 'function') {{ checkAuthStatus(); }}", null);
                }}
            }});
        }}
    }}

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {{
        if (requestCode == FILECHOOSER_RESULTCODE) {{
            if (mUploadMessage != null) {{
                Uri[] result = null;
                if (resultCode == RESULT_OK && data != null) {{
                    if (data.getData() != null) {{
                        result = new Uri[]{{data.getData()}};
                    }} else if (data.getClipData() != null) {{
                        int count = data.getClipData().getItemCount();
                        result = new Uri[count];
                        for (int i = 0; i < count; i++) {{
                            result[i] = data.getClipData().getItemAt(i).getUri();
                        }}
                    }}
                }}
                mUploadMessage.onReceiveValue(result);
                mUploadMessage = null;
            }}
        }}
        super.onActivityResult(requestCode, resultCode, data);
    }}

    @Override
    protected void onResume() {{
        super.onResume();
        if (mWebView != null) {{
            mWebView.evaluateJavascript("if (typeof checkAuthStatus === 'function') {{ checkAuthStatus(); }}", null);
        }}
    }}

    @Override
    public void onBackPressed() {{
        if (mWebView != null && mWebView.canGoBack()) {{
            mWebView.goBack();
        }} else {{
            super.onBackPressed();
        }}
    }}
}}
"""
(JAVA_SRC_DIR / "MainActivity.java").write_text(java_content.strip(), encoding="utf-8")
print("Wrote MainActivity.java.")

# 10. Copy web assets to assets/
for file_name in ["index.html", "style.css", "app.js", "config.js"]:
    src_file = BASE_DIR / file_name
    if src_file.exists():
        shutil.copy2(src_file, ASSETS_DIR / file_name)

# Inject config.js in assets and root
config_js_content = f"""// Auto-injected Build Environment Configuration
window.VAULT_CONFIG = {{
  BACKEND_URL: "{BACKEND_URL}"
}};
"""
(ASSETS_DIR / "config.js").write_text(config_js_content.strip(), encoding="utf-8")
(BASE_DIR / "config.js").write_text(config_js_content.strip(), encoding="utf-8")

assets_img_dir = ASSETS_DIR / "assets"
assets_img_dir.mkdir(parents=True, exist_ok=True)
for img_name in ["cloud_logo.jpg", "hero_guide.jpg"]:
    if (BASE_DIR / "assets" / img_name).exists():
        shutil.copy2(BASE_DIR / "assets" / img_name, assets_img_dir / img_name)

print("Copied web assets.")

# 11. Compile resources with AAPT2
compiled_res = BUILD_DIR / "compiled_res.zip"
cmd_compile = [
    str(AAPT2), "compile",
    "--dir", str(RES_DIR),
    "-o", str(compiled_res)
]
print("Running AAPT2 compile...")
subprocess.check_call(cmd_compile)

# 12. Link resources with AAPT2
unaligned_apk = BUILD_DIR / "unaligned.apk"
cmd_link = [
    str(AAPT2), "link",
    "-I", str(ANDROID_JAR),
    "--manifest", str(SRC_DIR / "AndroidManifest.xml"),
    "--java", str(GEN_DIR),
    "-o", str(unaligned_apk),
    "-A", str(ASSETS_DIR),
    str(compiled_res),
    "--auto-add-overlay"
]
print("Running AAPT2 link...")
subprocess.check_call(cmd_link)

# 13. Compile Java sources (R.java + MainActivity.java)
print("Compiling Java sources...")
java_files = list(GEN_DIR.rglob("*.java")) + list(JAVA_SRC_DIR.glob("*.java"))
cmd_javac = [
    str(JAVAC),
    "--release", "17",
    "-cp", str(ANDROID_JAR),
    "-d", str(OBJ_DIR),
] + [str(f) for f in java_files]
subprocess.check_call(cmd_javac)

# 14. Convert .class files to classes.dex using D8
print("Running D8 dexer...")
class_files = list(OBJ_DIR.rglob("*.class"))
cmd_d8 = [
    str(D8),
    "--lib", str(ANDROID_JAR),
    "--output", str(BUILD_DIR),
] + [str(f) for f in class_files]
subprocess.check_call(cmd_d8, shell=True)

dex_file = BUILD_DIR / "classes.dex"
if not dex_file.exists():
    raise RuntimeError("classes.dex was not generated!")

# 15. Insert classes.dex into unaligned.apk
print("Adding classes.dex into APK...")
with zipfile.ZipFile(unaligned_apk, "a") as z:
    z.write(dex_file, "classes.dex")

# 16. Align APK using ZIPALIGN
aligned_apk = BUILD_DIR / "aligned.apk"
cmd_zipalign = [
    str(ZIPALIGN),
    "-f", "4",
    str(unaligned_apk),
    str(aligned_apk)
]
print("Running zipalign...")
subprocess.check_call(cmd_zipalign)

# 17. Use persistent release keystore (does not change across rebuilds!)
keystore_file = KEYSTORE_DIR / "digitalvault-release.keystore"
KEYSTORE_PASS = "digitalvault_secure_keystore_2026"
KEY_ALIAS = "digitalvault_release_key"
KEY_PASS = "digitalvault_secure_keystore_2026"

if not keystore_file.exists():
    print(f"Generating permanent release keystore at: {keystore_file}...")
    cmd_keytool = [
        str(KEYTOOL),
        "-genkey", "-v",
        "-keystore", str(keystore_file),
        "-storepass", KEYSTORE_PASS,
        "-alias", KEY_ALIAS,
        "-keypass", KEY_PASS,
        "-keyalg", "RSA",
        "-keysize", "2048",
        "-validity", "10000",
        "-dname", "CN=Digital Vault,OU=Digital Memory Vault,O=Digital Vault,C=US"
    ]
    subprocess.check_call(cmd_keytool)
else:
    print(f"Using existing persistent release keystore: {keystore_file}")

# 18. Sign APK using APKSIGNER
release_apk = DIST_DIR / "DigitalMemoryVault-release.apk"
standard_apk = DIST_DIR / "DigitalMemoryVault.apk"
root_apk = BASE_DIR / "DigitalMemoryVault.apk"

for out_file in [release_apk, standard_apk, root_apk]:
    if out_file.exists():
        try:
            out_file.unlink()
        except Exception:
            pass

cmd_sign = [
    str(APKSIGNER), "sign",
    "--ks", str(keystore_file),
    "--ks-pass", f"pass:{KEYSTORE_PASS}",
    "--ks-key-alias", KEY_ALIAS,
    "--key-pass", f"pass:{KEY_PASS}",
    "--out", str(release_apk),
    str(aligned_apk)
]
print("Running apksigner...")
subprocess.check_call(cmd_sign, shell=True)

# Copy to release/DigitalMemoryVault.apk and root DigitalMemoryVault.apk
shutil.copy2(release_apk, standard_apk)
shutil.copy2(release_apk, root_apk)

# 19. Verify APK
cmd_verify = [
    str(APKSIGNER), "verify",
    "--verbose",
    str(release_apk)
]
print("Verifying APK...")
subprocess.check_call(cmd_verify, shell=True)

apk_size_mb = release_apk.stat().st_size / (1024 * 1024)
print(f"\n=======================================================")
print(f"SUCCESS! Release APK generated and signed with persistent key!")
print(f"Release APK: {release_apk} ({apk_size_mb:.2f} MB)")
print(f"Standard APK: {standard_apk} ({apk_size_mb:.2f} MB)")
print(f"Root APK: {root_apk} ({apk_size_mb:.2f} MB)")
print(f"=======================================================\n")

