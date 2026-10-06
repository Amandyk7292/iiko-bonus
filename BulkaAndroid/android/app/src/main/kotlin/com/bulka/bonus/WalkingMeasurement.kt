package com.bulka.bonus

import java.security.MessageDigest
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Strict server day boundaries; this class neither accepts nor reads Dart step totals. */
internal object WalkingMeasurement {
    const val MAX_STEPS = 150000
    private const val DAY_MILLIS = 86400000L
    private val rewardZone = TimeZone.getTimeZone("GMT+05:00")
    private val timestampPattern = Regex("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z")
    private val datePattern = Regex("\\d{4}-\\d{2}-\\d{2}")
    private val challengePattern = Regex("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+")

    data class Period(val date: String, val startAt: String, val endAt: String,
                      val startMillis: Long, val endMillis: Long)

    fun challenge(value: Any?): String {
        val text = value as? String ?: throw IllegalArgumentException("Invalid challenge")
        require(text.length in 32..8192 && challengePattern.matches(text)) { "Invalid challenge" }
        return text
    }

    fun periods(value: Any?, now: Long): List<Period> {
        val input = value as? List<*> ?: throw IllegalArgumentException("Invalid periods")
        require(input.size in 1..7) { "Invalid periods" }
        val today = Calendar.getInstance(rewardZone, Locale.US).apply {
            timeInMillis = now
            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val dayFormatter = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = rewardZone }
        val seen = mutableSetOf<String>()
        return input.map { raw ->
            val row = raw as? Map<*, *> ?: throw IllegalArgumentException("Invalid period")
            require(row.keys == setOf("date", "startAt", "endAt")) { "Unexpected period fields" }
            val date = row["date"] as? String ?: throw IllegalArgumentException("Invalid date")
            val startAt = row["startAt"] as? String ?: throw IllegalArgumentException("Invalid start")
            val endAt = row["endAt"] as? String ?: throw IllegalArgumentException("Invalid end")
            require(datePattern.matches(date) && seen.add(date)) { "Invalid or duplicate date" }
            val start = timestamp(startAt)
            val end = timestamp(endAt)
            require(dayFormatter.format(Date(start)) == date) { "Date mismatch" }
            val offset = today - start
            require(offset >= 0 && offset <= 6 * DAY_MILLIS && offset % DAY_MILLIS == 0L) { "Invalid day" }
            require(end > start && end - start <= DAY_MILLIS && end <= now + 30000L) { "Invalid range" }
            require(offset == 0L || end == start + DAY_MILLIS) { "Incomplete historical day" }
            Period(date, startAt, endAt, start, end)
        }
    }

    private fun timestamp(text: String): Long {
        require(timestampPattern.matches(text)) { "Invalid UTC timestamp" }
        val parser = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            isLenient = false; timeZone = TimeZone.getTimeZone("UTC")
        }
        val position = ParsePosition(0)
        val parsed = parser.parse(text, position)
        require(parsed != null && position.index == text.length) { "Invalid UTC timestamp" }
        return parsed.time
    }

    fun boundedSteps(values: Iterable<Int>): Int {
        var sum = 0L
        for (count in values) {
            require(count >= 0) { "Invalid step count" }
            sum += count
            require(sum <= MAX_STEPS) { "Invalid step count" }
        }
        return sum.toInt()
    }

    fun payload(challenge: String, periods: List<Period>, measuredSteps: List<Int>): String {
        challenge(challenge)
        require(periods.size == measuredSteps.size && periods.isNotEmpty()) { "Invalid measurements" }
        val rows = periods.mapIndexed { index, period ->
            val steps = boundedSteps(listOf(measuredSteps[index]))
            "{\"date\":\"${period.date}\",\"steps\":$steps,\"startAt\":\"${period.startAt}\",\"endAt\":\"${period.endAt}\"}"
        }
        return "{\"challenge\":\"$challenge\",\"source\":\"android_local_recording\",\"measurements\":[${rows.joinToString(",") }]}"
    }

    fun digest(text: String): ByteArray = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))

    fun deviceId(androidId: String): String {
        val normalized = androidId.lowercase(Locale.US)
        require(Regex("[a-f0-9]{16}").matches(normalized) && normalized != "0000000000000000" &&
            normalized != "9774d56d682e549c") { "Invalid Android ID" }
        return digest("bulka:walking:android:v1:$normalized")
            .joinToString("") { "%02x".format(it.toInt() and 255) }
    }
}
