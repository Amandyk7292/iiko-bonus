package com.bulka.bonus

import android.content.Context
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.bulka.bonus.data.*
import com.bulka.bonus.ui.BulkaBonusTheme
import com.bulka.bonus.ui.LoginScreen
import com.bulka.bonus.ui.MainScreen
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val api = BulkaApi.create()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("bulka_prefs", Context.MODE_PRIVATE)

        setContent {
            BulkaBonusTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val scope = rememberCoroutineScope()
                    val gson = remember { Gson() }
                    var savedPhone by remember { mutableStateOf(prefs.getString("phone", null)) }
                    var currentCustomer by remember {
                        mutableStateOf<Customer?>(
                            prefs.getString("customer", null)?.let { json ->
                                try { gson.fromJson(json, Customer::class.java) } catch (e: Exception) { null }
                            }
                        )
                    }
                    var currentTransactions by remember {
                        mutableStateOf<List<Transaction>>(
                            prefs.getString("transactions", null)?.let { json ->
                                try {
                                    val type = object : TypeToken<List<Transaction>>() {}.type
                                    gson.fromJson(json, type) ?: emptyList()
                                } catch (e: Exception) { emptyList() }
                            } ?: emptyList()
                        )
                    }
                    var showNameField by remember { mutableStateOf(false) }

                    LaunchedEffect(savedPhone) {
                        savedPhone?.let { phone ->
                            while(true) {
                                try {
                                    val res = api.getProfile(AuthRequest(phone, "", false))
                                    if (res.exists && res.customer != null) {
                                        currentCustomer = res.customer
                                        currentTransactions = res.transactions ?: emptyList()
                                        prefs.edit()
                                            .putString("customer", gson.toJson(res.customer))
                                            .putString("transactions", gson.toJson(res.transactions))
                                            .apply()
                                    } else {
                                        savedPhone = null
                                        currentCustomer = null
                                        prefs.edit().remove("phone").remove("customer").remove("transactions").apply()
                                        break
                                    }
                                } catch (e: Exception) {
                                    e.printStackTrace()
                                }
                                delay(5000)
                            }
                        }
                    }

                    if (savedPhone == null) {
                        LoginScreen(
                            onRequestOtp = { phone ->
                                try {
                                    val res = api.requestOtp(OtpRequest(phone))
                                    if (res.success) {
                                        Pair(true, null)
                                    } else {
                                        Pair(false, res.message ?: res.error ?: "Ошибка при отправке кода")
                                    }
                                } catch (e: Exception) {
                                    Pair(false, "Ошибка сети")
                                }
                            },
                            onVerifyOtp = { phone, code ->
                                try {
                                    val res = api.verifyOtp(OtpVerifyRequest(phone, code))
                                    if (res.success && res.customer != null) {
                                        prefs.edit()
                                            .putString("phone", phone)
                                            .putString("customer", gson.toJson(res.customer))
                                            .putString("transactions", gson.toJson(res.transactions ?: emptyList<Transaction>()))
                                            .apply()
                                        savedPhone = phone
                                        currentCustomer = res.customer
                                        currentTransactions = res.transactions ?: emptyList()
                                        Pair(true, null)
                                    } else {
                                        Pair(false, res.message ?: res.error ?: "Неверный код")
                                    }
                                } catch (e: Exception) {
                                    Pair(false, "Ошибка сети")
                                }
                            }
                        )
                    } else if (currentCustomer == null) {
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                                Spacer(modifier = Modifier.height(16.dp))
                                Text("Загрузка профиля...", style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    } else {
                        MainScreen(
                            customer = currentCustomer!!,
                            transactions = currentTransactions,
                            onLogout = {
                                prefs.edit().remove("phone").remove("customer").remove("transactions").apply()
                                savedPhone = null
                                currentCustomer = null
                                currentTransactions = emptyList()
                            }
                        )
                    }
                }
            }
        }
    }
}
