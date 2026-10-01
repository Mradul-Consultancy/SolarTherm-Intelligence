/*
 * esp32_ota_metrics.ino
 * ======================
 * Solar Thermal Harvesting — Device Diagnostics Publisher
 *
 * Add this snippet to your existing ESP32 sketch (the one that already
 * publishes /logs to Firebase). It pushes REAL device health metrics to
 * /device in Firebase every 10 seconds, replacing the dashboard's
 * simulated OTA panel values with actual hardware telemetry.
 *
 * Requires: Firebase ESP32 Client library (mobizt/Firebase-ESP-Client)
 *           — you almost certainly already have this if /logs works.
 *
 * Firebase node written:
 *   /device/fw_version   (string)  — bump this string on every code change
 *   /device/uptime_s      (int)    — seconds since last boot
 *   /device/rssi          (int)    — WiFi signal strength in dBm
 *   /device/heap_free     (int)    — free heap memory in bytes
 *   /device/last_seen     (int)    — millis() timestamp of this update
 */

// ── Add near the top of your sketch, with your other #define lines ──
#define FW_VERSION "v2.2.0"              // bump this on every firmware update
#define DEVICE_METRICS_INTERVAL_MS 10000 // push every 10 seconds

unsigned long lastMetricsPush = 0;

// ── Call this once inside loop(), alongside your existing sensor-publish call ──
void publishDeviceMetrics() {
  if (millis() - lastMetricsPush < DEVICE_METRICS_INTERVAL_MS) return;
  lastMetricsPush = millis();

  FirebaseJson json;
  json.set("fw_version", FW_VERSION);
  json.set("uptime_s", (int)(millis() / 1000));
  json.set("rssi", WiFi.RSSI());              // typical range: -30 (excellent) to -90 (very weak)
  json.set("heap_free", (int)ESP.getFreeHeap());
  json.set("last_seen", (int)(millis() / 1000));

  if (Firebase.RTDB.setJSON(&fbdo, "/device", &json)) {
    Serial.println("[Metrics] Device diagnostics pushed to /device");
  } else {
    Serial.print("[Metrics] Push failed: ");
    Serial.println(fbdo.errorReason());
  }
}

/*
 * ── Integration steps ──────────────────────────────────────────
 * 1. Paste #define FW_VERSION, DEVICE_METRICS_INTERVAL_MS, and
 *    `unsigned long lastMetricsPush` near your other globals.
 * 2. Paste the publishDeviceMetrics() function anywhere in the file.
 * 3. Inside your existing loop(), add one line right after your
 *    normal sensor-publishing call:
 *
 *      void loop() {
 *        // ... your existing sensor read + /logs publish code ...
 *        publishDeviceMetrics();   // <-- add this line
 *      }
 *
 * 4. Re-upload to your ESP32. Within 10 seconds the dashboard's
 *    "Device OTA Monitor" panel will show your REAL firmware version,
 *    uptime, WiFi signal, and free heap — replacing the placeholder
 *    values that were there before.
 *
 * 5. On the dashboard side (already done in app.js): updateOTA() now
 *    reads from /device instead of simulating values, with a graceful
 *    fallback to "no device data yet" if this node doesn't exist.
 * ── ─────────────────────────────────────────────────────────────
 */
