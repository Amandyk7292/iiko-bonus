package com.bulka.bonus

import org.junit.Assert.*
import org.junit.Test
import java.text.SimpleDateFormat
import java.util.Base64
import java.util.Locale
import java.util.TimeZone

class WalkingMeasurementTest {
    private val challenge = "aaaaaaaaaaa.bbbbbbbbbbbbb.cccccccccccc"
    private val now = utc("2026-10-06T07:00:00.000Z")
    private fun utc(value: String): Long = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(value)!!.time
    private fun period(date: String = "2026-10-06", start: String = "2026-10-05T19:00:00.000Z",
                       end: String = "2026-10-06T07:00:00.000Z") = mapOf("date" to date, "startAt" to start, "endAt" to end)
    private fun invalid(block: () -> Unit) {
        try { block(); fail("Expected rejection") } catch (_: IllegalArgumentException) { }
    }

    @Test fun acceptsFixedKazakhstanDayIndependentOfPhoneTimezone() {
        val before = TimeZone.getDefault()
        try {
            for (zone in listOf("America/Los_Angeles", "Asia/Tokyo", "UTC")) {
                TimeZone.setDefault(TimeZone.getTimeZone(zone))
                val result = WalkingMeasurement.periods(listOf(period()), now)
                assertEquals("2026-10-06", result.single().date)
                assertEquals(utc("2026-10-05T19:00:00.000Z"), result.single().startMillis)
            }
        } finally { TimeZone.setDefault(before) }
    }

    @Test fun retainsRequestedBatchOrderAcrossSevenDistinctDays() {
        val rows = listOf(period(), period("2026-10-05", "2026-10-04T19:00:00.000Z", "2026-10-05T19:00:00.000Z"),
            period("2026-09-30", "2026-09-29T19:00:00.000Z", "2026-09-30T19:00:00.000Z"))
        assertEquals(listOf("2026-10-06", "2026-10-05", "2026-09-30"), WalkingMeasurement.periods(rows, now).map { it.date })
    }

    @Test fun rejectsOldFutureDuplicateAndOversizedBatches() {
        invalid { WalkingMeasurement.periods(emptyList<Any>(), now) }
        invalid { WalkingMeasurement.periods(List(8) { period() }, now) }
        invalid { WalkingMeasurement.periods(listOf(period(), period()), now) }
        invalid { WalkingMeasurement.periods(listOf(period("2026-09-29", "2026-09-28T19:00:00.000Z", "2026-09-29T19:00:00.000Z")), now) }
        invalid { WalkingMeasurement.periods(listOf(period("2026-10-07", "2026-10-06T19:00:00.000Z", "2026-10-07T19:00:00.000Z")), now) }
    }

    @Test fun rejectsInvalidCalendarAndNonCanonicalOrWrongBoundaries() {
        invalid { WalkingMeasurement.periods(listOf(period(start = "2026-10-05T00:00:00.000Z")), now) }
        invalid { WalkingMeasurement.periods(listOf(period(start = "2026-10-06T00:00:00.000+05:00")), now) }
        invalid { WalkingMeasurement.periods(listOf(period(date = "2026-10-05")), now) }
        invalid { WalkingMeasurement.periods(listOf(period(start = "2026-02-30T19:00:00.000Z")), now) }
        invalid { WalkingMeasurement.periods(listOf(period(end = "2026-10-06T07:00:31.000Z")), now) }
        invalid { WalkingMeasurement.periods(listOf(period(end = "2026-10-05T19:00:00.000Z")), now) }
        invalid { WalkingMeasurement.periods(listOf(period("2026-10-05", "2026-10-04T19:00:00.000Z", "2026-10-05T18:00:00.000Z")), now) }
        invalid { WalkingMeasurement.periods(listOf(period() + ("steps" to 10000)), now) }
    }

    @Test fun rejectsMalformedChallengeAndInjectedJson() {
        invalid { WalkingMeasurement.challenge("\"source\":\"manual\"") }
        invalid { WalkingMeasurement.challenge("a.b.c") }
        invalid { WalkingMeasurement.challenge("a".repeat(9000) + ".b.c") }
        assertEquals(challenge, WalkingMeasurement.challenge(challenge))
    }

    @Test fun nativeCountsAreBoundedBeforeProofIncludingOverflow() {
        assertEquals(0, WalkingMeasurement.boundedSteps(emptyList()))
        assertEquals(20000, WalkingMeasurement.boundedSteps(listOf(10000, 10000)))
        assertEquals(150000, WalkingMeasurement.boundedSteps(listOf(100000, 50000)))
        invalid { WalkingMeasurement.boundedSteps(listOf(-1)) }
        invalid { WalkingMeasurement.boundedSteps(listOf(150000, 1)) }
        invalid { WalkingMeasurement.boundedSteps(listOf(Int.MAX_VALUE, Int.MAX_VALUE)) }
    }

    @Test fun payloadIncludesExactNativeSourceAndImmutableServerPeriod() {
        val rows = WalkingMeasurement.periods(listOf(period()), now)
        val payload = WalkingMeasurement.payload(challenge, rows, listOf(20000))
        assertEquals("{\"challenge\":\"$challenge\",\"source\":\"android_local_recording\",\"measurements\":[{\"date\":\"2026-10-06\",\"steps\":20000,\"startAt\":\"2026-10-05T19:00:00.000Z\",\"endAt\":\"2026-10-06T07:00:00.000Z\"}]}", payload)
        invalid { WalkingMeasurement.payload(challenge, rows, emptyList()) }
        assertFalse(WalkingMeasurement.digest(payload).contentEquals(WalkingMeasurement.digest(payload.replace("20000", "20001"))))
        val nonce = Base64.getUrlEncoder().withoutPadding().encodeToString(WalkingMeasurement.digest(payload))
        assertEquals(43, nonce.length)
        assertTrue(nonce.matches(Regex("[A-Za-z0-9_-]{43}")))
    }

    @Test fun deviceIdentityIsStableAndRejectsBrokenOldAndroidIds() {
        assertEquals(WalkingMeasurement.deviceId("0123456789abcdef"), WalkingMeasurement.deviceId("0123456789ABCDEF"))
        assertEquals(64, WalkingMeasurement.deviceId("0123456789abcdef").length)
        assertNotEquals(WalkingMeasurement.deviceId("0123456789abcdef"), WalkingMeasurement.deviceId("fedcba9876543210"))
        invalid { WalkingMeasurement.deviceId("") }
        invalid { WalkingMeasurement.deviceId("9774d56d682e549c") }
        invalid { WalkingMeasurement.deviceId("9774D56D682E549C") }
    }

    @Test fun rejectsMissingAllZeroHardwareIdentity() {
        invalid { WalkingMeasurement.deviceId("0000000000000000") }
    }
}
