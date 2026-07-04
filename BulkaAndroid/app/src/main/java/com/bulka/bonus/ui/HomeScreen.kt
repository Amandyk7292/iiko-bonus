package com.bulka.bonus.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.bulka.bonus.data.Customer
import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.asImageBitmap
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import android.graphics.Color as AndroidColor
import coil.compose.AsyncImage
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.border

data class Story(val id: Int, val title: String, val imageUrl: String)

val mockStories = listOf(
    Story(1, "СЕЗОННЫЙ ФРАППЕ", "https://images.unsplash.com/photo-1572490122747-3968b75bf699?w=500&q=80"),
    Story(2, "НОВИНКА", "https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=500&q=80"),
    Story(3, "ПЛЮШКИ ЗА ДРУГА", "https://images.unsplash.com/photo-1559525839-b184a4d698c7?w=500&q=80")
)

@Composable
fun HomeScreen(
    customer: Customer,
    onNavigateToProfile: () -> Unit
) {
    var showQrModal by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        // Top Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 24.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.clickable { onNavigateToProfile() }
            ) {
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Person,
                        contentDescription = "Profile",
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(28.dp)
                    )
                }
                Spacer(modifier = Modifier.width(12.dp))
                Column {
                    Text(
                        text = "Добро пожаловать,",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f)
                    )
                    Text(
                        text = customer.name,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onBackground
                    )
                }
            }
            
            IconButton(onClick = { /* Notifications */ }) {
                Icon(
                    imageVector = Icons.Default.Notifications,
                    contentDescription = "Notifications",
                    tint = MaterialTheme.colorScheme.onBackground
                )
            }
        }
        
        // Stories Row
        LazyRow(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 24.dp),
            contentPadding = PaddingValues(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(mockStories) { story ->
                StoryItem(story)
            }
        }

        // Dynamic Card Colors based on Tier
        val tierName = customer.tier?.name?.lowercase() ?: ""
        
        val colorStart: Color
        val colorEnd: Color
        val chipTextColor: Color
        val mainTextColor: Color
        val subTextColor: Color
        val watermarkColor: Color

        when {
            tierName.contains("платина") -> {
                colorStart = Color(0xFF434343)
                colorEnd = Color(0xFF000000) // Premium black/dark gray for Platinum
                chipTextColor = Color(0xFF212121)
                mainTextColor = Color.White
                subTextColor = Color.White.copy(alpha = 0.8f)
                watermarkColor = Color.White.copy(alpha = 0.15f)
            }
            tierName.contains("золото") -> {
                colorStart = Color(0xFFFFD54F)
                colorEnd = Color(0xFFFF8F00)
                chipTextColor = Color(0xFFFF8F00)
                mainTextColor = Color.White
                subTextColor = Color.White.copy(alpha = 0.9f)
                watermarkColor = Color.White.copy(alpha = 0.15f)
            }
            tierName.contains("серебро") -> {
                colorStart = Color(0xFFEEEEEE)
                colorEnd = Color(0xFF9E9E9E)
                chipTextColor = Color(0xFF424242)
                mainTextColor = Color(0xFF212121)
                subTextColor = Color(0xFF424242)
                watermarkColor = Color.Black.copy(alpha = 0.1f)
            }
            tierName.contains("бронза") -> {
                colorStart = Color(0xFFD7CCC8)
                colorEnd = Color(0xFF8D6E63)
                chipTextColor = Color(0xFF5D4037)
                mainTextColor = Color.White
                subTextColor = Color.White.copy(alpha = 0.9f)
                watermarkColor = Color.White.copy(alpha = 0.15f)
            }
            else -> {
                colorStart = Color(0xFFFFD54F)
                colorEnd = Color(0xFFFF8F00)
                chipTextColor = Color(0xFFFF8F00)
                mainTextColor = Color.White
                subTextColor = Color.White.copy(alpha = 0.9f)
                watermarkColor = Color.White.copy(alpha = 0.15f)
            }
        }

        // Loyalty Card 2026 Design
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .height(220.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(
                    brush = Brush.linearGradient(
                        colors = listOf(colorStart, colorEnd)
                    )
                )
        ) {
            // Giant Watermark Text for Percentage
            Text(
                text = "${customer.cashbackPercent}%",
                fontSize = 140.sp,
                fontWeight = FontWeight.Black,
                color = watermarkColor,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .offset(x = 20.dp, y = 40.dp)
            )
            
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp),
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Top
                ) {
                    Column {
                        Text(
                            text = "КАРТА ГОСТЯ",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = subTextColor
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "${customer.balance} ₸",
                            fontSize = 36.sp,
                            fontWeight = FontWeight.Bold,
                            color = mainTextColor
                        )
                    }
                    
                    // Chip
                    Surface(
                        color = Color.White.copy(alpha = if (tierName.contains("серебро")) 0.8f else 1f),
                        shape = RoundedCornerShape(16.dp)
                    ) {
                        Text(
                            text = "${customer.cashbackPercent}% КЭШБЭК",
                            fontWeight = FontWeight.Bold,
                            color = chipTextColor,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                            fontSize = 12.sp
                        )
                    }
                }
                
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Bottom
                ) {
                    Column {
                        Text(
                            text = customer.tier?.name?.uppercase() ?: "СТАТУС",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                            color = mainTextColor
                        )
                        Text(
                            text = "Потрачено: ${customer.totalSpent} ₸",
                            fontSize = 12.sp,
                            color = subTextColor
                        )
                    }
                    
                    Button(
                        onClick = { showQrModal = true },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color.White.copy(alpha = if (tierName.contains("серебро")) 0.8f else 1f),
                            contentColor = chipTextColor
                        ),
                        shape = RoundedCornerShape(16.dp),
                        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp)
                    ) {
                        Text("Мой QR", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }

    if (showQrModal) {
        Dialog(onDismissRequest = { showQrModal = false }) {
            Surface(
                shape = RoundedCornerShape(24.dp),
                color = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "МОЙ QR",
                            color = MaterialTheme.colorScheme.onSurface,
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp
                        )
                        IconButton(onClick = { showQrModal = false }) {
                            Text("X", color = MaterialTheme.colorScheme.onSurface, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                    
                    Spacer(modifier = Modifier.height(24.dp))
                    
                    // Actual QR Code
                    val qrBitmap = remember(customer.phone) {
                        generateQrBitmap("7${customer.phone}", 512)
                    }
                    
                    if (qrBitmap != null) {
                        Image(
                            bitmap = qrBitmap.asImageBitmap(),
                            contentDescription = "QR Code",
                            modifier = Modifier.size(200.dp)
                        )
                    } else {
                        Box(
                            modifier = Modifier
                                .size(200.dp)
                                .background(Color.White)
                        )
                    }
                    
                    Spacer(modifier = Modifier.height(24.dp))
                    
                    Text(
                        text = "Покажите QR кассиру для оплаты",
                        color = MaterialTheme.colorScheme.onSurface,
                        fontSize = 16.sp
                    )
                    
                    Spacer(modifier = Modifier.height(16.dp))
                    
                    Text(
                        text = "+${customer.phone}",
                        color = MaterialTheme.colorScheme.onSurface,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "Ваш уникальный код",
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                        fontSize = 14.sp
                    )
                }
            }
        }
    }
}

fun generateQrBitmap(content: String, sizePx: Int): Bitmap? {
    return try {
        val bitMatrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, sizePx, sizePx)
        val width = bitMatrix.width
        val height = bitMatrix.height
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565)
        for (x in 0 until width) {
            for (y in 0 until height) {
                bitmap.setPixel(x, y, if (bitMatrix.get(x, y)) AndroidColor.BLACK else AndroidColor.WHITE)
            }
        }
        bitmap
    } catch (e: Exception) {
        null
    }
}

@Composable
fun StoryItem(story: Story) {
    Box(
        modifier = Modifier
            .width(110.dp)
            .height(140.dp)
            .clip(RoundedCornerShape(16.dp))
            .border(2.dp, Color(0xFF2CA5E0), RoundedCornerShape(16.dp))
            .clickable { /* open story */ }
    ) {
        AsyncImage(
            model = story.imageUrl,
            contentDescription = story.title,
            contentScale = androidx.compose.ui.layout.ContentScale.Crop,
            modifier = Modifier.fillMaxSize()
        )
        // Dark gradient overlay for text readability
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        colors = listOf(
                            Color.Black.copy(alpha = 0.6f),
                            Color.Transparent,
                            Color.Black.copy(alpha = 0.3f)
                        )
                    )
                )
        )
        Text(
            text = story.title,
            color = Color.White,
            fontWeight = FontWeight.Bold,
            fontSize = 12.sp,
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(8.dp)
        )
    }
}
