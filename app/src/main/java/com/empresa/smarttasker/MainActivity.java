package com.empresa.smarttasker;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * SmartTasker — casca Android.
 *
 * O aplicativo é uma WebView que carrega os assets locais (offline, sem
 * rede) e expõe uma ponte nativa (AndroidBridge) para recursos do sistema:
 *   - persistSave/persistLoad: guarda o estado do app em SharedPreferences
 *     (sobrevive à limpeza de cache do WebView);
 *   - notificar: cria notificação nativa (canais no Android 8+);
 *   - vibrar: feedback tátil;
 *   - compartilhar: envia o backup JSON para outro app.
 *
 * Zero dependências externas: usa apenas a API do framework Android.
 */
public class MainActivity extends Activity {

    private static final String PREFS = "smarttasker";
    private static final String CANAL = "smarttasker_lembretes";
    private static final int NOTIF_ID = 1001;

    private WebView web;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        criarCanal();
        pedirPermissaoNotificacao();

        web = new WebView(this);
        WebSettings cfg = web.getSettings();
        cfg.setJavaScriptEnabled(true);
        cfg.setDomStorageEnabled(true);
        cfg.setDatabaseEnabled(true);
        cfg.setAllowFileAccess(true);
        cfg.setSupportZoom(false);
        cfg.setMediaPlaybackRequiresUserGesture(false);

        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new Ponte(), "AndroidBridge");

        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
    }

    private void criarCanal() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CANAL) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CANAL, "Lembretes de tarefas", NotificationManager.IMPORTANCE_DEFAULT);
                ch.setDescription("Avisos de tarefas vencendo");
                nm.createNotificationChannel(ch);
            }
        }
    }

    private void pedirPermissaoNotificacao() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 10);
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /** Ponte exposta ao JavaScript como window.AndroidBridge. */
    public class Ponte {

        @JavascriptInterface
        public void persistSave(String chave, String valor) {
            prefs.edit().putString(chave, valor).apply();
        }

        @JavascriptInterface
        public String persistLoad(String chave) {
            return prefs.getString(chave, null);
        }

        @JavascriptInterface
        public void notificar(String titulo, String texto) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            Intent abrir = new Intent(MainActivity.this, MainActivity.class);
            abrir.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pi = PendingIntent.getActivity(MainActivity.this, 0, abrir, flags);

            Notification.Builder b;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                b = new Notification.Builder(MainActivity.this, CANAL);
            } else {
                b = new Notification.Builder(MainActivity.this);
            }
            b.setContentTitle(titulo == null ? "SmartTasker" : titulo)
                    .setContentText(texto == null ? "" : texto)
                    .setSmallIcon(R.drawable.ic_launcher)
                    .setContentIntent(pi)
                    .setAutoCancel(true);
            nm.notify(NOTIF_ID, b.build());
        }

        @JavascriptInterface
        public void vibrar(int ms) {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(ms);
            }
        }

        @JavascriptInterface
        public void compartilhar(String texto) {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_TEXT, texto);
            startActivity(Intent.createChooser(i, "Compartilhar backup"));
        }
    }
}
