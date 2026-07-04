package com.bulka.bonus.data

import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.POST

data class OtpRequest(val phone: String)
data class OtpVerifyRequest(val phone: String, val code: String)
data class OtpResponse(val success: Boolean, val error: String?, val message: String?)

interface BulkaApi {
    @POST("/api/guest/profile")
    suspend fun getProfile(@Body request: AuthRequest): ProfileResponse

    @POST("/api/auth/request-otp")
    suspend fun requestOtp(@Body request: OtpRequest): OtpResponse

    @POST("/api/auth/verify-otp")
    suspend fun verifyOtp(@Body request: OtpVerifyRequest): ProfileResponse

    @retrofit2.http.GET("/api/guest/menu")
    suspend fun getMenu(): MenuResponse

    companion object {
        private const val BASE_URL = "https://iiko-bonus.onrender.com"

        fun create(): BulkaApi {
            val retrofit = Retrofit.Builder()
                .baseUrl(BASE_URL)
                .addConverterFactory(GsonConverterFactory.create())
                .build()
            return retrofit.create(BulkaApi::class.java)
        }
    }
}
