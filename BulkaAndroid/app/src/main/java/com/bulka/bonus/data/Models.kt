package com.bulka.bonus.data

import com.google.gson.annotations.SerializedName

data class AuthRequest(
    val phone: String,
    val name: String,
    val register: Boolean,
    val fcmToken: String? = null
)

data class ProfileResponse(
    val success: Boolean = true,
    val error: String? = null,
    val message: String? = null,
    val exists: Boolean,
    val customer: Customer?,
    val transactions: List<Transaction>?
)

data class Customer(
    val id: String,
    val name: String,
    val phone: String,
    val balance: Double,
    @SerializedName("total_spent") val totalSpent: Double,
    @SerializedName("created_at") val createdAt: String,
    val isVip: Boolean,
    val cashbackPercent: Int,
    val vipThreshold: Int,
    val tier: Tier?
)

data class Tier(
    val name: String,
    val percent: Int,
    val nextTier: String?,
    val nextTh: Int?,
    val remaining: Double,
    val progress: Double
)

data class Transaction(
    val id: String,
    @SerializedName("customer_id") val customerId: String,
    @SerializedName("order_id") val orderId: String?,
    val type: String,
    val amount: Double,
    @SerializedName("order_total") val orderTotal: Double?,
    val timestamp: String
)

data class MenuCategory(
    val id: String,
    val name: String,
    val order: Int
)

data class MenuItem(
    val id: String,
    val name: String,
    val description: String,
    val price: Double,
    val categoryId: String?,
    val imageUrl: String?
)

data class MenuResponse(
    val success: Boolean,
    val categories: List<MenuCategory>?,
    val products: List<MenuItem>?,
    val error: String?
)
