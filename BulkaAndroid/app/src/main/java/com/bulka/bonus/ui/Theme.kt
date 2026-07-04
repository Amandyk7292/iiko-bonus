package com.bulka.bonus.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val BulkaYellow = Color(0xFFFFB300)
val BulkaBrown = Color(0xFF6D3317)
val MilkyBackground = Color(0xFFFDFBF7)
val LightCard = Color(0xFFFFFFFF)
val LightCardHighlight = Color(0xFFF5F0E6)
val TextDark = Color(0xFF3E2723)

private val LightColorScheme = lightColorScheme(
    primary = BulkaYellow,
    onPrimary = Color.Black,
    secondary = BulkaBrown,
    onSecondary = Color.White,
    background = MilkyBackground,
    onBackground = TextDark,
    surface = LightCard,
    onSurface = TextDark,
    surfaceVariant = LightCardHighlight,
    onSurfaceVariant = TextDark
)

@Composable
fun BulkaBonusTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LightColorScheme,
        content = content
    )
}
