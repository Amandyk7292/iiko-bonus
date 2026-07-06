package com.bulka.bonus.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.bulka.bonus.data.BulkaApi

@Composable
fun NewsScreen() {
    var stories by remember { mutableStateOf<List<Story>>(emptyList()) }
    var selectedStoryIndex by remember { mutableStateOf<Int?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var errorText by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            isLoading = true
            val res = BulkaApi.create().getStories()
            stories = res.stories.orEmpty().map {
                Story(
                    id = it.id,
                    title = it.title,
                    imageUrl = it.coverUrl,
                    contentUrl = it.contentUrl,
                    description = it.description,
                    duration = it.duration
                )
            }
            errorText = null
        } catch (e: Exception) {
            errorText = "Новости временно недоступны"
        } finally {
            isLoading = false
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        when {
            isLoading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            errorText != null -> Text(
                text = errorText ?: "",
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.align(Alignment.Center)
            )
            stories.isEmpty() -> Text(
                text = "Новостей пока нет",
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f),
                modifier = Modifier.align(Alignment.Center)
            )
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, top = 24.dp, end = 20.dp, bottom = 120.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp)
            ) {
                item {
                    Text(
                        text = "Новости",
                        color = MaterialTheme.colorScheme.onBackground,
                        fontSize = 28.sp,
                        fontWeight = FontWeight.Black
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Акции, новинки и события Bulka",
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                        fontSize = 14.sp
                    )
                }

                itemsIndexed(stories) { index, story ->
                    NewsCard(story = story, onClick = { selectedStoryIndex = index })
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
private fun NewsCard(story: Story, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(MaterialTheme.colorScheme.surface)
            .clickable { onClick() }
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(360.dp)
        ) {
            AsyncImage(
                model = story.contentUrl.ifBlank { story.imageUrl },
                contentDescription = story.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(Color.Transparent, Color.Black.copy(alpha = 0.58f)),
                            startY = 150f
                        )
                    )
            )
            Column(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(18.dp)
            ) {
                Text(
                    text = story.title,
                    color = Color.White,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold
                )
                if (!story.description.isNullOrBlank()) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = story.description,
                        color = Color.White.copy(alpha = 0.88f),
                        fontSize = 14.sp,
                        lineHeight = 19.sp
                    )
                }
            }
        }
    }
}
