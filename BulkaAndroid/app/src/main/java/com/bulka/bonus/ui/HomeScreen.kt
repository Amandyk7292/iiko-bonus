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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.border
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.material.icons.filled.Close
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.window.DialogProperties
import com.bulka.bonus.data.BulkaApi
import com.bulka.bonus.data.NewsItem
import com.bulka.bonus.data.PromoStory
import com.bulka.bonus.data.QrTokenRequest
import kotlinx.coroutines.launch

data class Story(
    val id: Long,
    val title: String,
    val imageUrl: String,
    val contentUrl: String = imageUrl,
    val description: String? = null,
    val duration: Int = 15
)

@Composable
fun HomeScreen(
    customer: Customer,
    onNavigateToProfile: () -> Unit
) {
    var showQrModal by remember { mutableStateOf(false) }
    var stories by remember { mutableStateOf<List<Story>>(emptyList()) }
    var news by remember { mutableStateOf<List<NewsItem>>(emptyList()) }
    var selectedStoryIndex by remember { mutableStateOf<Int?>(null) }

    LaunchedEffect(Unit) {
        val api = BulkaApi.create()
        try {
            val res = api.getStories()
            if (res.success && res.stories != null) {
                stories = res.stories.map {
                    Story(
                        id = it.id,
                        title = it.title,
                        imageUrl = it.coverUrl,
                        contentUrl = it.contentUrl,
                        description = it.description,
                        duration = it.duration
                    )
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        try {
            val res = api.getNews()
            if (res.success && res.news != null) {
                news = res.news
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState())
            .padding(bottom = 116.dp)
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
            itemsIndexed(stories) { index, story ->
                StoryItem(story, onClick = { selectedStoryIndex = index })
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

        if (news.isNotEmpty()) {
            Spacer(modifier = Modifier.height(24.dp))
            NewsFeedSection(news = news)
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
                    
                    var timeRemaining by remember { mutableStateOf(300 - ((System.currentTimeMillis() % 300000) / 1000).toInt()) }
                    var otpString by remember { mutableStateOf("") }
                    var qrError by remember { mutableStateOf<String?>(null) }
                    var loadedWindow by remember { mutableStateOf<Long?>(null) }
                    
                    LaunchedEffect(Unit) {
                        val api = BulkaApi.create()
                        while(true) {
                            val timeWindow = System.currentTimeMillis() / 300000
                            timeRemaining = 300 - ((System.currentTimeMillis() % 300000) / 1000).toInt()
                            if (loadedWindow != timeWindow || otpString.isBlank()) {
                                try {
                                    val response = api.getQrToken(QrTokenRequest(customer.phone))
                                    if (response.success && !response.token.isNullOrBlank()) {
                                        otpString = response.token
                                        loadedWindow = timeWindow
                                        qrError = null
                                    } else {
                                        qrError = response.error ?: "QR временно недоступен"
                                    }
                                } catch (e: Exception) {
                                    qrError = "QR временно недоступен"
                                }
                            }
                            kotlinx.coroutines.delay(1000)
                        }
                    }
                    
                    val qrBitmap = remember(otpString) {
                        if (otpString.isNotEmpty()) generateQrBitmap(otpString, 512) else null
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

                    if (qrError != null) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = qrError ?: "",
                            color = MaterialTheme.colorScheme.error,
                            fontSize = 12.sp
                        )
                    }
                    
                    Spacer(modifier = Modifier.height(16.dp))
                    
                    val m = (timeRemaining / 60).toString().padStart(2, '0')
                    val s = (timeRemaining % 60).toString().padStart(2, '0')
                    
                    Text(
                        text = "Динамический код (обновится через)",
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                        fontSize = 12.sp
                    )
                    Text(
                        text = "$m:$s",
                        color = MaterialTheme.colorScheme.onSurface,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold
                    )
                    
                    Spacer(modifier = Modifier.height(20.dp))
                    
                    val context = androidx.compose.ui.platform.LocalContext.current
                    Button(
                        onClick = {
                            val url = "https://iiko-bonus.onrender.com/api/wallet/google/direct?phone=${customer.phone}"
                            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))
                            try {
                                context.startActivity(intent)
                            } catch (e: Exception) {
                                android.widget.Toast.makeText(context, "Не удалось открыть Google Wallet", android.widget.Toast.LENGTH_SHORT).show()
                            }
                        },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFF1F1F1F),
                            contentColor = Color.White
                        ),
                        shape = RoundedCornerShape(24.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp)
                    ) {
                        Text(
                            text = "Добавить в Google Wallet",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        }
    }

    selectedStoryIndex?.let { index ->
        StoryViewerModal(
            stories = stories,
            initialIndex = index,
            onClose = { selectedStoryIndex = null }
        )
    }
}

@Composable
private fun NewsFeedSection(news: List<NewsItem>) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text(
            text = "Новости",
            color = MaterialTheme.colorScheme.onBackground,
            fontSize = 22.sp,
            fontWeight = FontWeight.Black
        )
        news.forEach { item ->
            NewsFeedCard(item = item)
        }
    }
}

@Composable
private fun NewsFeedCard(item: NewsItem) {
    val image = item.imageUrl.ifBlank { item.imageurl.orEmpty() }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(MaterialTheme.colorScheme.surface)
    ) {
        AsyncImage(
            model = image,
            contentDescription = item.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .fillMaxWidth()
                .height(260.dp)
        )
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = item.title,
                color = MaterialTheme.colorScheme.onSurface,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold
            )
            if (!item.description.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = item.description,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.68f),
                    fontSize = 14.sp,
                    lineHeight = 20.sp
                )
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
fun StoryItem(story: Story, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .width(110.dp)
            .height(140.dp)
            .clip(RoundedCornerShape(16.dp))
            .border(2.dp, Color(0xFFFFB300), RoundedCornerShape(16.dp))
            .clickable { onClick() }
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

@Composable
fun StoryViewerModal(
    stories: List<Story>,
    initialIndex: Int,
    onClose: () -> Unit
) {
    var currentIndex by remember { mutableIntStateOf(initialIndex) }
    val currentStory = stories.getOrNull(currentIndex) ?: return
    val progress = remember { Animatable(0f) }

    LaunchedEffect(currentIndex) {
        progress.snapTo(0f)
        val durationMs = (currentStory.duration * 1000).coerceAtLeast(3000)
        progress.animateTo(
            targetValue = 1f,
            animationSpec = tween(durationMillis = durationMs, easing = LinearEasing)
        )
        if (currentIndex < stories.size - 1) {
            currentIndex++
        } else {
            onClose()
        }
    }

    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black)
                .pointerInput(Unit) {
                    detectVerticalDragGestures { _, dragAmount ->
                        if (dragAmount > 50) onClose()
                    }
                }
        ) {
            // Full screen story image
            AsyncImage(
                model = currentStory.contentUrl,
                contentDescription = currentStory.title,
                contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )

            // Dark gradient overlay top & bottom for readability
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                Color.Black.copy(alpha = 0.7f),
                                Color.Transparent,
                                Color.Transparent,
                                Color.Black.copy(alpha = 0.8f)
                            )
                        )
                    )
            )

            // Touch navigation zones (Left 30% prev, Right 70% next)
            Row(modifier = Modifier.fillMaxSize()) {
                Box(
                    modifier = Modifier
                        .weight(0.3f)
                        .fillMaxHeight()
                        .clickable(
                            interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() },
                            indication = null
                        ) {
                            if (currentIndex > 0) {
                                currentIndex--
                            } else {
                                onClose()
                            }
                        }
                )
                Box(
                    modifier = Modifier
                        .weight(0.7f)
                        .fillMaxHeight()
                        .clickable(
                            interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() },
                            indication = null
                        ) {
                            if (currentIndex < stories.size - 1) {
                                currentIndex++
                            } else {
                                onClose()
                            }
                        }
                )
            }

            // Top Progress Bars and Header
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 48.dp, start = 16.dp, end = 16.dp)
            ) {
                // Horizontal progress bars
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    stories.forEachIndexed { idx, _ ->
                        val barProgress = when {
                            idx < currentIndex -> 1f
                            idx == currentIndex -> progress.value
                            else -> 0f
                        }
                        LinearProgressIndicator(
                            progress = barProgress,
                            modifier = Modifier
                                .weight(1f)
                                .height(3.dp)
                                .clip(RoundedCornerShape(1.5.dp)),
                            color = Color.White,
                            trackColor = Color.White.copy(alpha = 0.3f),
                        )
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                // Story Header (Avatar + Title + Close button)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(32.dp)
                                .clip(CircleShape)
                                .background(Color(0xFF6D3317)),
                            contentAlignment = Alignment.Center
                        ) {
                            Text("B", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        }
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            text = currentStory.title,
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp
                        )
                    }

                    IconButton(onClick = onClose) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "Close",
                            tint = Color.White,
                            modifier = Modifier.size(28.dp)
                        )
                    }
                }
            }

            // Bottom Description
            if (!currentStory.description.isNullOrBlank()) {
                Column(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 40.dp)
                ) {
                    Text(
                        text = currentStory.description,
                        color = Color.White,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium,
                        lineHeight = 22.sp
                    )
                }
            }
        }
    }
}
