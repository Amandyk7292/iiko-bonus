package com.bulka.bonus.data

import com.bulka.bonus.BuildConfig
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

data class OtpRequest(val phone: String, val token: String? = null)
data class OtpVerifyRequest(val phone: String, val code: String, val fcmToken: String? = null)
data class OtpResponse(val success: Boolean, val error: String?, val message: String?)
data class QrTokenRequest(val phone: String)
data class QrTokenResponse(val success: Boolean, val token: String?, val expiresAt: Long?, val ttlSeconds: Int?, val error: String?)

data class PromoStory(
    val id: Long,
    val title: String,
    val coverUrl: String,
    val contentUrl: String,
    val description: String?,
    val duration: Int = 15
)
data class StoriesResponse(val success: Boolean, val stories: List<PromoStory>?)

data class NewsItem(
    val id: Long,
    val title: String,
    val imageUrl: String,
    val imageurl: String? = null,
    val description: String? = null,
    val created_at: String? = null
)
data class NewsResponse(val success: Boolean, val news: List<NewsItem>?, val error: String? = null)

interface BulkaApi {
    @POST("/api/guest/profile")
    suspend fun getProfile(@Body request: AuthRequest): ProfileResponse

    @POST("/api/guest/qr-token")
    suspend fun getQrToken(@Body request: QrTokenRequest): QrTokenResponse

    @POST("/api/auth/request-otp")
    suspend fun requestOtp(@Body request: OtpRequest): OtpResponse

    @POST("/api/auth/verify-otp")
    suspend fun verifyOtp(@Body request: OtpVerifyRequest): ProfileResponse

    @GET("/api/guest/menu")
    suspend fun getMenu(): MenuResponse

    @GET("/api/guest/stories")
    suspend fun getStories(): StoriesResponse

    @GET("/api/guest/news")
    suspend fun getNews(): NewsResponse

    companion object {
        fun create(): BulkaApi {
            val baseUrl = BuildConfig.BULKA_API_BASE_URL.let {
                if (it.endsWith("/")) it else "$it/"
            }
            val retrofit = Retrofit.Builder()
                .baseUrl(baseUrl)
                .addConverterFactory(GsonConverterFactory.create())
                .build()
            return retrofit.create(BulkaApi::class.java)
        }
    }
}
