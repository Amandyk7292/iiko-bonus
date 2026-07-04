package com.bulka.bonus

import android.content.Context
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import com.bulka.bonus.data.*
import com.bulka.bonus.ui.BulkaBonusTheme
import com.bulka.bonus.ui.LoginScreen
import com.bulka.bonus.ui.MainScreen
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
                    var savedPhone by remember { mutableStateOf(prefs.getString("phone", null)) }
                    var currentCustomer by remember { mutableStateOf<Customer?>(null) }
                    var currentTransactions by remember { mutableStateOf<List<Transaction>>(emptyList()) }
                    var showNameField by remember { mutableStateOf(false) }

                    LaunchedEffect(savedPhone) {
                        savedPhone?.let { phone ->
                            while(true) {
                                try {
                                    val res = api.getProfile(AuthRequest(phone, "", false))
                                    if (res.exists && res.customer != null) {
                                        currentCustomer = res.customer
                                        currentTransactions = res.transactions ?: emptyList()
                                    } else {
                                        savedPhone = null
                                        prefs.edit().remove("phone").apply()
                                        break
                                    }
                                } catch (e: Exception) {
                                    e.printStackTrace()
                                }
                                delay(5000)
                            }
                        }
                    }

                    if (savedPhone == null || currentCustomer == null) {
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
                                        prefs.edit().putString("phone", phone).apply()
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
                    } else {
                        MainScreen(
                            customer = currentCustomer!!,
                            transactions = currentTransactions,
                            onLogout = {
                                prefs.edit().remove("phone").apply()
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
