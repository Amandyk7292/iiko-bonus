param()

Add-Type -AssemblyName PresentationFramework

$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Оплата бонусами (Предпросмотр)" Height="350" Width="450"
        WindowStartupLocation="CenterScreen"
        Topmost="True"
        Background="#F5F5F5">
    <Grid Margin="20">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto" />
            <RowDefinition Height="Auto" />
            <RowDefinition Height="Auto" />
            <RowDefinition Height="Auto" />
            <RowDefinition Height="*" />
        </Grid.RowDefinitions>

        <TextBlock Grid.Row="0" Text="Поиск клиента" FontSize="18" FontWeight="Bold" Margin="0,0,0,15" />
        
        <StackPanel Grid.Row="1" Orientation="Horizontal" Margin="0,0,0,20">
            <TextBlock Text="Телефон:" VerticalAlignment="Center" FontSize="16" Width="90" />
            <TextBox Width="200" FontSize="16" Padding="5" Text="+77001234567" />
            <Button Content="Найти" Width="100" Margin="10,0,0,0" FontSize="14" Background="#2196F3" Foreground="White" />
        </StackPanel>

        <Border Grid.Row="2" Background="White" BorderBrush="#E0E0E0" BorderThickness="1" CornerRadius="5" Padding="15" Margin="0,0,0,20">
            <StackPanel>
                <TextBlock FontSize="16" FontWeight="SemiBold" Margin="0,0,0,10" Text="Клиент: Иван Иванов (+77001234567)" />
                <TextBlock FontSize="16" Foreground="#4CAF50" FontWeight="Bold" Text="Баланс: 1500 бонусов" />
            </StackPanel>
        </Border>

        <StackPanel Grid.Row="3">
            <TextBlock Text="Сколько бонусов списать?" FontSize="14" Margin="0,0,0,5" />
            <StackPanel Orientation="Horizontal">
                <TextBox Width="150" FontSize="16" Padding="5" Text="500" />
                <Button Content="Списать" Width="120" Margin="10,0,0,0" FontSize="14" Background="#4CAF50" Foreground="White" />
            </StackPanel>
        </StackPanel>

        <TextBlock Grid.Row="4" Foreground="Green" FontSize="14" Margin="0,10,0,0" TextWrapping="Wrap" Text="Успешно: Баланс найден" />
    </Grid>
</Window>
"@

$reader = (New-Object System.Xml.XmlNodeReader ([xml]$xaml))
$window = [Windows.Markup.XamlReader]::Load($reader)

$window.ShowDialog() | Out-Null
