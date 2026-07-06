package com.bulka.bonus.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.List
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.ShoppingCart
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.bulka.bonus.data.Customer
import com.bulka.bonus.data.Transaction

sealed class BottomNavItem(
    val route: String, 
    val iconSelected: ImageVector, 
    val iconUnselected: ImageVector, 
    val title: String
) {
    object Home : BottomNavItem("home", Icons.Filled.Home, Icons.Outlined.Home, "Главная")
    object News : BottomNavItem("news", Icons.Filled.List, Icons.Outlined.List, "Новости")
    object Menu : BottomNavItem("menu", Icons.Filled.List, Icons.Outlined.List, "Меню")
    object Orders : BottomNavItem("orders", Icons.Filled.Person, Icons.Outlined.Person, "Мои заказы")
    object Cart : BottomNavItem("cart", Icons.Filled.ShoppingCart, Icons.Outlined.ShoppingCart, "Корзина")
}

@Composable
fun MainScreen(
    customer: Customer,
    transactions: List<Transaction>,
    onLogout: () -> Unit
) {
    val navController = rememberNavController()
    val items = listOf(
        BottomNavItem.Home,
        BottomNavItem.News,
        BottomNavItem.Orders
    )

    Scaffold(
        bottomBar = {
            val navBackStackEntry by navController.currentBackStackEntryAsState()
            val currentRoute = navBackStackEntry?.destination?.route
            
            // Show bottom bar only on main tabs
            if (currentRoute in items.map { it.route }) {
                FloatingNavBar(
                    items = items,
                    currentRoute = currentRoute,
                    onItemClick = { route ->
                        navController.navigate(route) {
                            popUpTo(navController.graph.startDestinationId) { saveState = true }
                            launchSingleTop = true
                            restoreState = true
                        }
                    }
                )
            }
        }
    ) { innerPadding ->
        // We use Box and ignore innerPadding for the bottom to let content scroll behind the floating nav bar
        // But we still apply it for top and general structure. For a true floating feel, we pad the bottom of Lists.
        Box(modifier = Modifier.fillMaxSize()) {
            NavHost(
                navController = navController,
                startDestination = "home",
                modifier = Modifier.fillMaxSize()
            ) {
                composable("home") { 
                    HomeScreen(
                        customer = customer,
                        onNavigateToProfile = { navController.navigate("profile") }
                    ) 
                }
                composable("menu") { MenuScreen() }
                composable("news") { NewsScreen() }
                composable("orders") { OrdersScreen(transactions = transactions) }
                composable("cart") { CartScreen() }
                composable("profile") { 
                    ProfileScreen(
                        customer = customer, 
                        onLogout = onLogout,
                        onBack = { navController.popBackStack() }
                    ) 
                }
            }
        }
    }
}

@Composable
fun FloatingNavBar(
    items: List<BottomNavItem>,
    currentRoute: String?,
    onItemClick: (String) -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 24.dp),
        contentAlignment = Alignment.BottomCenter
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(40.dp),
            color = Color.White,
            shadowElevation = 8.dp
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                items.forEach { item ->
                    val isSelected = currentRoute == item.route
                    
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(32.dp))
                            .background(if (isSelected) Color(0xFFFFF3D0) else Color.Transparent) // Warm amber highlight
                            .clickable { onItemClick(item.route) }
                            .padding(vertical = 12.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            imageVector = if (isSelected) item.iconSelected else item.iconUnselected,
                            contentDescription = item.title,
                            tint = if (isSelected) Color(0xFF6D3317) else Color.Gray,
                            modifier = Modifier.size(24.dp)
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = item.title,
                            fontSize = 10.sp,
                            color = if (isSelected) Color(0xFF6D3317) else Color.Gray,
                            fontWeight = if (isSelected) androidx.compose.ui.text.font.FontWeight.Bold else androidx.compose.ui.text.font.FontWeight.Normal
                        )
                    }
                }
            }
        }
    }
}
