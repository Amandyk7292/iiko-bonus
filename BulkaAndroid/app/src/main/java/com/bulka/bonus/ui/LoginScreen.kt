package com.bulka.bonus.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoginScreen(
    onRequestOtp: suspend (String, String) -> Pair<Boolean, String?>,
    onVerifyOtp: suspend (String, String) -> Pair<Boolean, String?>
) {
    var phoneInput by remember { mutableStateOf("") }
    
    // Step 1 = Phone, Step 2 = OTP
    var currentStep by remember { mutableStateOf(1) }
    var otpInput by remember { mutableStateOf("") }
    
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    
    var generatedToken by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = "Bulka Bonus",
            color = MaterialTheme.colorScheme.primary,
            fontSize = 32.sp,
            fontWeight = FontWeight.Bold
        )
        Spacer(modifier = Modifier.height(48.dp))

        if (currentStep == 1) {
            // Step 1: Phone Input
            OutlinedTextField(
                value = phoneInput,
                onValueChange = { newValue ->
                    errorMessage = null
                    val filtered = newValue.filter { it.isDigit() }
                    if (filtered.length <= 10) {
                        phoneInput = filtered
                    }
                },
                label = { Text("Номер телефона", color = MaterialTheme.colorScheme.onBackground.copy(alpha=0.7f)) },
                prefix = {
                    Text("+7 ", color = MaterialTheme.colorScheme.onBackground, fontWeight = FontWeight.Bold)
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                colors = TextFieldDefaults.outlinedTextFieldColors(
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    unfocusedBorderColor = MaterialTheme.colorScheme.primary,
                    cursorColor = MaterialTheme.colorScheme.primary,
                    focusedTextColor = MaterialTheme.colorScheme.onBackground,
                    unfocusedTextColor = MaterialTheme.colorScheme.onBackground
                ),
                modifier = Modifier.fillMaxWidth()
            )

            if (errorMessage != null) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(errorMessage!!, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                
                if (errorMessage!!.contains("Telegram", ignoreCase = true)) {
                    Spacer(modifier = Modifier.height(16.dp))
                    Button(
                        onClick = {
                            try {
                                val intent = Intent(Intent.ACTION_VIEW, Uri.parse("tg://resolve?domain=bulkawallet_bot"))
                                context.startActivity(intent)
                            } catch (e: Exception) {
                                val webIntent = Intent(Intent.ACTION_VIEW, Uri.parse("https://t.me/bulkawallet_bot"))
                                context.startActivity(webIntent)
                            }
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp),
                        shape = RoundedCornerShape(24.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2CA5E0))
                    ) {
                        Text("ОТКРЫТЬ TELEGRAM", color = Color.White, fontWeight = FontWeight.Bold)
                    }
                }
            }

            Spacer(modifier = Modifier.height(32.dp))

            val context = androidx.compose.ui.platform.LocalContext.current
            Button(
                onClick = {
                    if (phoneInput.length == 10) {
                        scope.launch {
                            isLoading = true
                            errorMessage = null
                            val fullPhone = "7$phoneInput"
                            val token = (100000..999999).random().toString()
                            generatedToken = token
                            val (success, error) = onRequestOtp(fullPhone, token)
                            isLoading = false
                            if (success) {
                                currentStep = 2
                                otpInput = ""
                                try {
                                    val intent = android.content.Intent(android.content.Intent.ACTION_VIEW)
                                    intent.data = android.net.Uri.parse("https://wa.me/77008317499?text=Код%20$token")
                                    context.startActivity(intent)
                                } catch (e: Exception) {
                                    // WhatsApp not installed
                                    android.widget.Toast.makeText(context, "Установите WhatsApp", android.widget.Toast.LENGTH_SHORT).show()
                                }
                            } else {
                                errorMessage = error ?: "Ошибка при запросе кода"
                            }
                        }
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                shape = RoundedCornerShape(24.dp),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                enabled = phoneInput.length == 10 && !isLoading
            ) {
                if (isLoading) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(24.dp))
                } else {
                    Text("ПОЛУЧИТЬ В WHATSAPP", color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold)
                }
            }
        } else {
            // Step 2: OTP Input
            Text(
                text = "Код можно получить в WhatsApp или Telegram",
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.7f),
                fontSize = 14.sp
            )
            Text(
                text = "+7 $phoneInput",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold
            )
            
            Spacer(modifier = Modifier.height(24.dp))
            
            OutlinedTextField(
                value = otpInput,
                onValueChange = { newValue ->
                    errorMessage = null
                    val filtered = newValue.filter { it.isDigit() }
                    if (filtered.length <= 4) {
                        otpInput = filtered
                    }
                },
                label = { Text("Код подтверждения", color = if (errorMessage != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onBackground.copy(alpha=0.7f)) },
                singleLine = true,
                isError = errorMessage != null,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                colors = TextFieldDefaults.outlinedTextFieldColors(
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    unfocusedBorderColor = MaterialTheme.colorScheme.primary,
                    cursorColor = MaterialTheme.colorScheme.primary,
                    focusedTextColor = MaterialTheme.colorScheme.onBackground,
                    unfocusedTextColor = MaterialTheme.colorScheme.onBackground
                ),
                modifier = Modifier.fillMaxWidth()
            )
            
            if (errorMessage != null) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(errorMessage!!, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
            }
            
            Spacer(modifier = Modifier.height(32.dp))

            Button(
                onClick = {
                    if (otpInput.length == 4) {
                        scope.launch {
                            isLoading = true
                            errorMessage = null
                            val fullPhone = "7$phoneInput"
                            val (success, error) = onVerifyOtp(fullPhone, otpInput)
                            isLoading = false
                            if (!success) {
                                errorMessage = error ?: "Неверный код"
                            }
                        }
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                shape = RoundedCornerShape(24.dp),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                enabled = otpInput.length == 4 && !isLoading
            ) {
                if (isLoading) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(24.dp))
                } else {
                    Text("ВОЙТИ", color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold)
                }
            }
            
            Spacer(modifier = Modifier.height(16.dp))
            
            TextButton(onClick = { 
                currentStep = 1 
                errorMessage = null
            }) {
                Text("Изменить номер", color = MaterialTheme.colorScheme.secondary)
            }
        }
    }
}
