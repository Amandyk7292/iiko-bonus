package com.bulka.bonus.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun CartScreen() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // Shopping bag icon placeholder (text for now)
        Text(
            text = "🛒",
            fontSize = 64.sp,
            modifier = Modifier.padding(bottom = 24.dp)
        )
        
        Text(
            text = "В корзине ничего нет",
            color = MaterialTheme.colorScheme.onBackground,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(bottom = 16.dp)
        )
        
        Text(
            text = "Посмотрите новинки или всё меню",
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.5f),
            fontSize = 14.sp,
            modifier = Modifier.padding(bottom = 32.dp)
        )
        
        Button(
            onClick = { /* navigate to menu */ },
            modifier = Modifier
                .fillMaxWidth(0.8f)
                .height(56.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant,
                contentColor = MaterialTheme.colorScheme.onBackground
            ),
            shape = RoundedCornerShape(24.dp)
        ) {
            Text(
                text = "ПЕРЕЙТИ К МЕНЮ",
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp
            )
        }
    }
}
