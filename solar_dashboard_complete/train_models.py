"""
train_models.py
================
Solar Thermal Harvesting — Real ML Model Training

Trains two genuine neural networks:
  1. LSTM forecaster  — predicts next-step [T1, T3] from a 10-step window
  2. Autoencoder       — learns normal operating signature for anomaly detection

Trained on physically-realistic SYNTHETIC data (diurnal solar profile with
thermal lag, noise, and flow dynamics) because live historical logs are not
reachable from this offline training environment.

TO RETRAIN ON YOUR REAL DATA:
  1. Export your Firebase /logs node to CSV (Firebase console > Export JSON,
     or write a small script using firebase-admin to pull /logs.json)
  2. Replace generate_synthetic_data() below with a CSV loader
  3. Re-run this script — it will overwrite weights.json with real-data weights

Output: weights.json  (LSTM + Autoencoder weights, normalization stats)
        Consumed directly by app.js at inference time (pure JS, no runtime
        TensorFlow.js dependency needed in the browser).
"""

import numpy as np
import tensorflow as tf
from tensorflow import keras
import json

np.random.seed(42)
tf.random.set_seed(42)

# ══════════════════════════════════════════════════════════
# 1. SYNTHETIC DATA GENERATOR
#    Mimics a real flat-plate solar collector's diurnal cycle
# ══════════════════════════════════════════════════════════
def generate_synthetic_data(n_days=6, pts_per_day=480):
    """1440 min/day @ 3-min resolution = 480 pts/day"""
    n = n_days * pts_per_day
    t = np.arange(n)
    minute_of_day = t % pts_per_day
    hour = minute_of_day / pts_per_day * 24

    # Solar irradiance: sinusoidal daytime bump (6am-6pm), zero at night, cloud noise
    G = np.clip(1000 * np.sin(np.pi * (hour - 6) / 12), 0, None)
    G += np.random.normal(0, 25, n) * (G > 0)          # cloud flicker
    cloud_days = np.random.choice(n_days, 2, replace=False)
    for d in cloud_days:
        mask = (t // pts_per_day) == d
        G[mask] *= np.random.uniform(0.5, 0.8)          # partly cloudy days

    ambient = 28 + 4 * np.sin(np.pi * (hour - 6) / 12)   # ambient temp cycle

    # T3 absorber: fast response to G (first-order lag, tau~3min)
    T3 = np.zeros(n); T3[0] = ambient[0]
    tau3 = 3
    for i in range(1, n):
        target = ambient[i] + G[i] * 0.055
        T3[i] = T3[i-1] + (target - T3[i-1]) / tau3

    # T4 outlet: lags T3 by ~4 steps (thermal mass of fluid in pipe)
    T4 = np.zeros(n); T4[0] = ambient[0]
    tau4 = 5
    for i in range(1, n):
        drive = T3[max(0, i-4)]
        T4[i] = T4[i-1] + (drive - T4[i-1]) / tau4

    # T1 storage: slow accumulator, charges from T4 during day
    T1 = np.zeros(n); T1[0] = ambient[0]
    tau1 = 40
    for i in range(1, n):
        T1[i] = T1[i-1] + (T4[i] - T1[i-1]) / tau1

    # T2 inlet: close to T1 minus small draw-down
    T2 = T1 - np.random.uniform(4, 9, n)

    # Flow: pump runs during day, small noise, F2 slightly < F1 (losses)
    pump_on = (G > 50).astype(float)
    F1 = pump_on * (2.4 + np.random.normal(0, 0.15, n))
    F1 = np.clip(F1, 0, None)
    F2 = F1 * np.random.uniform(0.92, 0.98, n)

    # add sensor noise
    T1 += np.random.normal(0, 0.15, n)
    T2 += np.random.normal(0, 0.15, n)
    T3 += np.random.normal(0, 0.2, n)
    T4 += np.random.normal(0, 0.18, n)

    data = np.stack([T1, T2, T3, T4, F1, F2], axis=1)
    return data.astype(np.float32)

data = generate_synthetic_data()
print(f"Synthetic dataset: {data.shape[0]} timesteps x {data.shape[1]} sensors")

# ══════════════════════════════════════════════════════════
# 2. LSTM FORECASTER — predicts next [T1, T3] from 10-step window
# ══════════════════════════════════════════════════════════
WINDOW = 10
feat_idx = [0, 2]  # T1, T3 columns

series = data[:, feat_idx]
mean = series.mean(axis=0)
std  = series.std(axis=0)
norm = (series - mean) / std

X, y = [], []
for i in range(len(norm) - WINDOW):
    X.append(norm[i:i+WINDOW])
    y.append(norm[i+WINDOW])
X = np.array(X, dtype=np.float32)
y = np.array(y, dtype=np.float32)

split = int(len(X) * 0.85)
X_train, X_test = X[:split], X[split:]
y_train, y_test = y[:split], y[split:]

print(f"\nLSTM training set: {X_train.shape}, test set: {X_test.shape}")

HIDDEN = 8
lstm_model = keras.Sequential([
    keras.layers.Input(shape=(WINDOW, 2)),
    keras.layers.LSTM(HIDDEN),
    keras.layers.Dense(2)
])
lstm_model.compile(optimizer=keras.optimizers.Adam(0.01), loss='mse')
history = lstm_model.fit(X_train, y_train, epochs=25, batch_size=32,
                          validation_data=(X_test, y_test), verbose=0)

pred_test = lstm_model.predict(X_test, verbose=0)
# de-normalize for real RMSE in °C
pred_denorm = pred_test * std + mean
true_denorm = y_test * std + mean
rmse_T1 = np.sqrt(np.mean((pred_denorm[:,0] - true_denorm[:,0])**2))
rmse_T3 = np.sqrt(np.mean((pred_denorm[:,1] - true_denorm[:,1])**2))
print(f"LSTM Test RMSE — T1: {rmse_T1:.3f}°C | T3: {rmse_T3:.3f}°C")
print(f"Final train loss: {history.history['loss'][-1]:.5f} | val loss: {history.history['val_loss'][-1]:.5f}")

# Extract weights — Keras LSTM gate order: [input, forget, cell, output]
lstm_layer = lstm_model.layers[0]
dense_layer = lstm_model.layers[1]
W_kernel, W_recurrent, W_bias = lstm_layer.get_weights()   # (2,32) (8,32) (32,)
W_dense, b_dense = dense_layer.get_weights()               # (8,2) (2,)

lstm_weights = {
    "window": WINDOW,
    "hidden": HIDDEN,
    "features": ["T1", "T3"],
    "norm_mean": mean.tolist(),
    "norm_std": std.tolist(),
    "kernel": W_kernel.tolist(),
    "recurrent_kernel": W_recurrent.tolist(),
    "bias": W_bias.tolist(),
    "dense_kernel": W_dense.tolist(),
    "dense_bias": b_dense.tolist(),
    "test_rmse_T1": float(rmse_T1),
    "test_rmse_T3": float(rmse_T3),
    "train_samples": int(len(X_train)),
    "epochs": 25,
}

# ══════════════════════════════════════════════════════════
# 3. AUTOENCODER — anomaly detection via reconstruction error
# ══════════════════════════════════════════════════════════
full_mean = data.mean(axis=0)
full_std  = data.std(axis=0)
full_norm = (data - full_mean) / full_std

ae_split = int(len(full_norm) * 0.85)
ae_train, ae_test = full_norm[:ae_split], full_norm[ae_split:]

encoder_units = [4, 3]  # 6 -> 4 -> 3 (bottleneck)
ae_model = keras.Sequential([
    keras.layers.Input(shape=(6,)),
    keras.layers.Dense(4, activation='relu', name='enc1'),
    keras.layers.Dense(3, activation='relu', name='enc2_bottleneck'),
    keras.layers.Dense(4, activation='relu', name='dec1'),
    keras.layers.Dense(6, activation='linear', name='dec2_output'),
])
ae_model.compile(optimizer=keras.optimizers.Adam(0.01), loss='mse')
ae_history = ae_model.fit(ae_train, ae_train, epochs=40, batch_size=32,
                           validation_data=(ae_test, ae_test), verbose=0)

recon_test = ae_model.predict(ae_test, verbose=0)
recon_errors = np.mean((recon_test - ae_test)**2, axis=1)
threshold = recon_errors.mean() + 2 * recon_errors.std()
print(f"\nAutoencoder final train loss: {ae_history.history['loss'][-1]:.5f}")
print(f"Reconstruction error — mean: {recon_errors.mean():.5f}, threshold(2σ): {threshold:.5f}")

ae_weights = {
    "layers": [],
    "norm_mean": full_mean.tolist(),
    "norm_std": full_std.tolist(),
    "threshold": float(threshold),
    "features": ["T1","T2","T3","T4","F1","F2"],
    "train_samples": int(len(ae_train)),
    "epochs": 40,
}
for layer in ae_model.layers:
    W, b = layer.get_weights()
    act = layer.activation.__name__
    ae_weights["layers"].append({
        "name": layer.name, "W": W.tolist(), "b": b.tolist(), "activation": act
    })

# ══════════════════════════════════════════════════════════
# 4. SAVE
# ══════════════════════════════════════════════════════════
output = {"lstm": lstm_weights, "autoencoder": ae_weights}
with open('/home/claude/ml_training/weights.json', 'w') as f:
    json.dump(output, f)

print(f"\n✓ Saved weights.json ({len(json.dumps(output))/1024:.1f} KB)")
print(f"✓ LSTM params: {lstm_model.count_params()}")
print(f"✓ Autoencoder params: {ae_model.count_params()}")
