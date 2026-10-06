package com.bulka.bonus

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.fitness.FitnessLocal
import com.google.android.gms.fitness.LocalRecordingClient
import com.google.android.gms.fitness.data.LocalDataType
import com.google.android.gms.fitness.data.LocalField
import com.google.android.gms.fitness.request.LocalDataReadRequest
import com.google.android.gms.fitness.result.LocalDataReadResponse
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.security.SecureRandom
import java.util.concurrent.TimeUnit

/** Only phone-local Recording API counts enter the Play Integrity signed payload. */
internal class WalkingRewardsBridge(private val activity: Activity) {
    private val main = Handler(Looper.getMainLooper())
    private val preferences = activity.getSharedPreferences("bulka.walking.android.v1", Activity.MODE_PRIVATE)
    private val client by lazy { FitnessLocal.getLocalRecordingClient(activity.applicationContext) }
    private val integrity by lazy { IntegrityManagerFactory.create(activity.applicationContext) }
    private var active: Operation? = null
    private var pendingPermission: (() -> Unit)? = null
    private var subscription: Task<Void>? = null
    private var stopping: Operation? = null
    private var disposed = false

    private inner class Operation(val result: MethodChannel.Result) {
        var completed = false
        val timeout = Runnable { error("WALKING_DEVICE_ERROR") }
        init { main.postDelayed(timeout, 40000L) }
        fun current(): Boolean = !disposed && !completed && active === this && stopping == null
        fun success(value: Any?) {
            if (completed) return
            completed = true; main.removeCallbacks(timeout)
            if (active === this) { active = null; pendingPermission = null }
            if (stopping === this) stopping = null
            if (!disposed) result.success(value)
        }
        fun error(code: String) {
            if (completed) return
            completed = true; main.removeCallbacks(timeout)
            if (active === this) { active = null; pendingPermission = null }
            if (stopping === this) stopping = null
            if (!disposed) result.error(code, null, null)
        }
    }

    fun handle(call: MethodCall, result: MethodChannel.Result) {
        if (disposed) { result.error("WALKING_DEVICE_ERROR", null, null); return }
        when (call.method) {
            "capabilities" -> {
                val state = servicesStatus()
                result.success(mapOf(
                    "supported" to (state == ConnectionResult.SUCCESS || needsUpdate(state)),
                    "authorized" to (state == ConnectionResult.SUCCESS && hasMotionPermission() && recordingEnabled()),
                    "requiresPlayServicesUpdate" to needsUpdate(state),
                ))
                // A failed disable remains durable; retry without requesting any permission.
                if (preferences.getBoolean("stop_requested", false) && state == ConnectionResult.SUCCESS && stopping == null) {
                    stop(object : MethodChannel.Result {
                        override fun success(value: Any?) = Unit
                        override fun error(code: String, message: String?, details: Any?) = Unit
                        override fun notImplemented() = Unit
                    })
                }
                return
            }
            "openSettings" -> { result.success(openSettings()); return }
            "stop" -> { stop(result); return }
            "identity", "attest", "measureBatch" -> Unit
            else -> { result.notImplemented(); return }
        }
        if (active != null || stopping != null || subscription != null) {
            result.error("WALKING_BUSY", null, null); return
        }
        val state = servicesStatus()
        if (state != ConnectionResult.SUCCESS) {
            result.error(if (needsUpdate(state)) "WALKING_PLAY_SERVICES_UPDATE" else "WALKING_UNSUPPORTED", null, null)
            return
        }
        val operation = Operation(result)
        active = operation
        try {
            val identity = identity()
            if (call.method == "identity") { operation.success(identity); return }
            val args = call.arguments as? Map<*, *> ?: throw IllegalArgumentException("Invalid arguments")
            require(args["deviceId"] == identity["deviceId"] && args["keyId"] == identity["keyId"])
            require(listOf("steps", "payload", "measurements", "assertion").none { args.containsKey(it) })
            val challenge = WalkingMeasurement.challenge(args["challenge"])
            if (call.method == "attest") {
                proof(operation, challenge) { token -> operation.success(mapOf("attestation" to token)) }
                return
            }
            val periods = WalkingMeasurement.periods(args["periods"], System.currentTimeMillis())
            val explicitConnect = args["requestPermission"] == true
            if (preferences.getBoolean("stop_requested", false)) {
                operation.error("WALKING_BUSY"); return
            }
            if (!explicitConnect && (!hasMotionPermission() || !recordingEnabled())) {
                operation.error("WALKING_PERMISSION"); return
            }
            val measure = {
                if (operation.current()) {
                    if (!hasMotionPermission()) operation.error("WALKING_PERMISSION")
                    else if (explicitConnect && !preferences.edit().putBoolean("recording_enabled", true).commit()) {
                        operation.error("WALKING_DEVICE_ERROR")
                    } else readBatch(operation, challenge, periods)
                }
            }
            if (hasMotionPermission()) measure()
            else if (explicitConnect && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                pendingPermission = measure
                activity.requestPermissions(arrayOf(Manifest.permission.ACTIVITY_RECOGNITION), PERMISSION_REQUEST)
            } else operation.error("WALKING_PERMISSION")
        } catch (_: IllegalArgumentException) {
            operation.error("WALKING_INVALID_CHALLENGE")
        } catch (_: Exception) {
            operation.error("WALKING_DEVICE_ERROR")
        }
    }

    fun onRequestPermissionsResult(requestCode: Int): Boolean {
        if (requestCode != PERMISSION_REQUEST) return false
        val resume = pendingPermission
        pendingPermission = null
        resume?.invoke()
        return true
    }

    private fun readBatch(operation: Operation, challenge: String, periods: List<WalkingMeasurement.Period>) {
        if (!operation.current() || !recordingEnabled()) return
        val subscribe = client.subscribe(LocalDataType.TYPE_STEP_COUNT_DELTA)
        subscription = subscribe
        subscribe.addOnCompleteListener { subscribed ->
            if (subscription === subscribe) subscription = null
            if (!operation.current() || !recordingEnabled()) {
                if (!recordingEnabled() && stopping == null) client.unsubscribe(LocalDataType.TYPE_STEP_COUNT_DELTA)
                return@addOnCompleteListener
            }
            if (!subscribed.isSuccessful) { operation.error("WALKING_DEVICE_ERROR"); return@addOnCompleteListener }
            try {
                val reads = periods.map { period ->
                    client.readData(LocalDataReadRequest.Builder()
                        .aggregate(LocalDataType.TYPE_STEP_COUNT_DELTA)
                        .bucketByTime(1, TimeUnit.DAYS)
                        .setTimeRange(period.startMillis, period.endMillis, TimeUnit.MILLISECONDS)
                        .build())
                }
                Tasks.whenAllSuccess<LocalDataReadResponse>(reads).addOnSuccessListener { responses ->
                    if (!operation.current() || !recordingEnabled()) return@addOnSuccessListener
                    try {
                        val counts = responses.mapIndexed { index, response -> steps(response, periods[index]) }
                        val payload = WalkingMeasurement.payload(challenge, periods, counts)
                        proof(operation, payload) { token ->
                            if (recordingEnabled()) operation.success(mapOf("payload" to payload, "assertion" to token))
                            else operation.error("WALKING_STOPPED")
                        }
                    } catch (_: Exception) { operation.error("WALKING_DEVICE_ERROR") }
                }.addOnFailureListener { if (operation.current()) operation.error("WALKING_DEVICE_ERROR") }
            } catch (_: Exception) { operation.error("WALKING_DEVICE_ERROR") }
        }
    }

    private fun steps(response: LocalDataReadResponse, period: WalkingMeasurement.Period): Int {
        require(response.status.isSuccess)
        val points = response.buckets.flatMap { it.dataSets }.flatMap { dataSet ->
            require(dataSet.dataType == LocalDataType.TYPE_STEP_COUNT_DELTA)
            dataSet.dataPoints
        }.sortedBy { it.getStartTime(TimeUnit.MILLISECONDS) }
        var previousEnd = period.startMillis
        val counts = points.map { point ->
            val start = point.getStartTime(TimeUnit.MILLISECONDS)
            val end = point.getEndTime(TimeUnit.MILLISECONDS)
            require(point.dataType == LocalDataType.TYPE_STEP_COUNT_DELTA)
            require(start >= previousEnd && end >= start && end <= period.endMillis)
            previousEnd = end
            point.getValue(LocalField.FIELD_STEPS).asInt()
        }
        return WalkingMeasurement.boundedSteps(counts)
    }

    private fun proof(operation: Operation, payload: String, onSuccess: (String) -> Unit) {
        if (!operation.current()) return
        val nonce = Base64.encodeToString(WalkingMeasurement.digest(payload), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        integrity.requestIntegrityToken(IntegrityTokenRequest.builder().setNonce(nonce).build())
            .addOnSuccessListener { response -> if (operation.current()) onSuccess(response.token()) }
            .addOnFailureListener { if (operation.current()) operation.error("WALKING_DEVICE_ERROR") }
    }

    private fun identity(): Map<String, String> {
        val androidId = Settings.Secure.getString(activity.contentResolver, Settings.Secure.ANDROID_ID)
            ?: throw IllegalArgumentException("No device identity")
        val deviceId = WalkingMeasurement.deviceId(androidId)
        var keyId = preferences.getString("installation_key", null)
        if (keyId == null) {
            val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
            keyId = Base64.encodeToString(bytes, Base64.NO_WRAP)
            check(preferences.edit().putString("installation_key", keyId).commit())
        }
        require(Regex("[A-Za-z0-9+/]{43}=").matches(keyId))
        return mapOf("deviceId" to deviceId, "keyId" to keyId, "platform" to "android")
    }

    private fun stop(result: MethodChannel.Result) {
        if (stopping != null) { result.error("WALKING_BUSY", null, null); return }
        if (!preferences.edit().putBoolean("recording_enabled", false).putBoolean("stop_requested", true).commit()) {
            result.error("WALKING_DEVICE_ERROR", null, null); return
        }
        active?.error("WALKING_STOPPED")
        val operation = Operation(result)
        stopping = operation
        val unsubscribe = {
            if (!disposed && !operation.completed) {
                try {
                    client.unsubscribe(LocalDataType.TYPE_STEP_COUNT_DELTA)
                        .addOnSuccessListener {
                            if (operation.completed || stopping !== operation) return@addOnSuccessListener
                            if (preferences.edit().putBoolean("stop_requested", false).commit()) operation.success(true)
                            else operation.error("WALKING_DEVICE_ERROR")
                        }
                        .addOnFailureListener { operation.error("WALKING_DEVICE_ERROR") }
                } catch (_: Exception) { operation.error("WALKING_DEVICE_ERROR") }
            }
        }
        // Wait for any subscribe to finish so its late completion cannot restart collection.
        val pending = subscription
        if (pending != null) pending.addOnCompleteListener { unsubscribe() }
        else unsubscribe()
    }

    private fun recordingEnabled(): Boolean = preferences.getBoolean("recording_enabled", false)
    private fun hasMotionPermission(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
        activity.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED
    private fun servicesStatus(): Int = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(
        activity, LocalRecordingClient.LOCAL_RECORDING_CLIENT_MIN_VERSION_CODE)
    private fun needsUpdate(status: Int): Boolean = status in setOf(ConnectionResult.SERVICE_VERSION_UPDATE_REQUIRED,
        ConnectionResult.SERVICE_MISSING, ConnectionResult.SERVICE_DISABLED, ConnectionResult.SERVICE_UPDATING)

    private fun openSettings(): Boolean = try {
        val state = servicesStatus()
        val intent = if (needsUpdate(state)) {
            GoogleApiAvailability.getInstance().getErrorResolutionIntent(activity, state, "bulka_walking")
                ?: Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:com.google.android.gms"))
        } else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${activity.packageName}"))
        activity.startActivity(intent)
        true
    } catch (_: Exception) { false }

    fun dispose() {
        active?.error("WALKING_DEVICE_ERROR")
        stopping?.error("WALKING_DEVICE_ERROR")
        pendingPermission = null
        disposed = true
    }

    companion object { private const val PERMISSION_REQUEST = 7292 }
}
