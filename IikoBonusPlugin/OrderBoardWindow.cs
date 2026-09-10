using System;
using System.Collections.Generic;
using System.Globalization;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal sealed class OrderBoardWindow : Window
    {
        private static readonly string[] Titles = { "Новые", "Готовятся", "Готовы", "Выданы" };
        private static readonly string[] Accent = { "#8A501C", "#385C91", "#267147", "#66615B" };
        private readonly StackPanel[] cards = new StackPanel[4];
        private readonly ScrollViewer[] scrolls = new ScrollViewer[4];
        private readonly TextBlock[] counts = new TextBlock[4];
        private readonly StackPanel[] pagination = new StackPanel[4];
        private readonly string[] rendered = new string[4];
        private readonly HashSet<string> pending = new HashSet<string>();
        private readonly TextBlock notice;
        private readonly Border noticeBox;
        private readonly bool canImport, automatic;
        private bool used, connected;
        private string confirmation, confirmAction, lastError;
        private BoardResponse snapshot;
        internal long? SelectedReceiptNumber { get; private set; }
        internal event Action<InboxOrder, string> ActionRequested;
        internal event Action RefreshRequested;
        internal event Action<int, int> PageRequested;
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        internal static IntPtr CaptureOwner()
        {
            var foreground = GetForegroundWindow();
            GetWindowThreadProcessId(foreground, out var processId);
            try {
                using (var process = Process.GetProcessById((int)processId))
                    return process.ProcessName.StartsWith("iikoFront", StringComparison.OrdinalIgnoreCase) ||
                        process.ProcessName.StartsWith("Resto.Front", StringComparison.OrdinalIgnoreCase) ? foreground : IntPtr.Zero;
            } catch { return IntPtr.Zero; }
        }
        private static SolidColorBrush Brush(string hex) => (SolidColorBrush)new BrushConverter().ConvertFromString(hex);
        private static TextBlock Text(string text, double size = 16, string color = "#302820", bool bold = false) =>
            new TextBlock { Text = text, FontSize = size, Foreground = Brush(color), TextWrapping = TextWrapping.Wrap,
                FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal, Margin = new Thickness(0, 0, 0, 8) };

        internal OrderBoardWindow(string branch, IntPtr owner, bool canImport, bool automatic)
        {
            this.canImport = canImport; this.automatic = automatic;
            KeyDown += (_, e) => {
                if (e.Key != System.Windows.Input.Key.Escape) return;
                if (confirmation != null) { confirmation = null; Render(); }
                else if (pending.Count == 0) Close();
            };
            Title = "Bulka · Экран заказов"; FontFamily = new FontFamily("Segoe UI");
            Background = Brushes.White; Foreground = Brush("#302820");
            WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize; ShowInTaskbar = false;
            ShowActivated = true; Topmost = automatic;
            Width = 1280; Height = 800; UseLayoutRounding = true;
            if (owner != IntPtr.Zero) new WindowInteropHelper(this).Owner = owner;
            SourceInitialized += (_, __) => {
                var monitor = System.Windows.Forms.Screen.FromHandle(owner).Bounds;
                var source = (HwndSource)PresentationSource.FromVisual(this);
                var transform = source.CompositionTarget.TransformFromDevice;
                var location = transform.Transform(new Point(monitor.Left, monitor.Top));
                var size = transform.Transform(new Point(monitor.Width, monitor.Height));
                Left = location.X; Top = location.Y; Width = size.X; Height = size.Y;
            };
            Resources.Add(typeof(Button), XamlReader.Parse(
                "<Style xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' TargetType='Button'>" +
                "<Setter Property='MinHeight' Value='48'/><Setter Property='Padding' Value='12,9'/><Setter Property='FontSize' Value='15'/>" +
                "<Setter Property='FontWeight' Value='SemiBold'/><Setter Property='Background' Value='#FFF3D6'/><Setter Property='Foreground' Value='#603B20'/>" +
                "<Setter Property='BorderBrush' Value='#E5DED5'/><Setter Property='BorderThickness' Value='1'/><Setter Property='Cursor' Value='Hand'/>" +
                "<Setter Property='Template'><Setter.Value><ControlTemplate TargetType='Button'><Border Background='{TemplateBinding Background}' BorderBrush='{TemplateBinding BorderBrush}' BorderThickness='{TemplateBinding BorderThickness}' CornerRadius='9' Padding='{TemplateBinding Padding}'>" +
                "<ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/></Border><ControlTemplate.Triggers>" +
                "<Trigger Property='IsMouseOver' Value='True'><Setter Property='Opacity' Value='0.88'/></Trigger>" +
                "<Trigger Property='IsPressed' Value='True'><Setter Property='Opacity' Value='0.7'/></Trigger>" +
                "<Trigger Property='IsEnabled' Value='False'><Setter Property='Opacity' Value='0.5'/></Trigger>" +
                "</ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>"));
            var root = new Grid { Margin = new Thickness(18), Background = Brushes.White };
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition());
            var header = new DockPanel { Margin = new Thickness(0, 0, 0, 12) };
            var controls = new StackPanel { Orientation = Orientation.Horizontal };
            controls.Children.Add(Button("Обновить", () => { used = true; RefreshRequested?.Invoke(); }));
            controls.Children.Add(Button("Вернуться к кассе", Close));
            DockPanel.SetDock(controls, Dock.Right); header.Children.Add(controls);
            var heading = new StackPanel(); heading.Children.Add(Text("Экран заказов", 26, bold: true));
            heading.Children.Add(Text(branch, 15, "#746A60")); header.Children.Add(heading); root.Children.Add(header);
            notice = Text("Загружаем заказы…", 17, bold: true); notice.Margin = new Thickness(0);
            noticeBox = new Border { Padding = new Thickness(14, 10, 14, 10), Margin = new Thickness(0, 0, 0, 14),
                CornerRadius = new CornerRadius(10), Background = Brush("#FFF5DF"), Child = notice };
            Grid.SetRow(noticeBox, 1); root.Children.Add(noticeBox);
            var columns = new Grid { MinWidth = 940 };
            for (var i = 0; i < 4; i++)
            {
                columns.ColumnDefinitions.Add(new ColumnDefinition());
                var column = BuildColumn(i); Grid.SetColumn(column, i); columns.Children.Add(column);
            }
            var horizontal = new ScrollViewer { HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
                VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, Content = columns };
            horizontal.SizeChanged += (_, __) => columns.Width = Math.Max(940, horizontal.ActualWidth);
            Grid.SetRow(horizontal, 2); root.Children.Add(horizontal); Content = root;
        }
        internal void AlertNewOrder()
        {
            if (!IsVisible) return;
            if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
            Topmost = true;
            Activate();
            System.Media.SystemSounds.Exclamation.Play();
            scrolls[0].ScrollToTop();
        }
        private Button Button(string label, Action action, bool primary = false)
        {
            var button = new Button { Content = new TextBlock { Text = label, TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center },
                Margin = new Thickness(0, 4, 5, 4) };
            if (primary) { button.Background = Brush("#673D24"); button.Foreground = Brushes.White; button.BorderBrush = button.Background; }
            button.Click += (_, __) => action(); return button;
        }
        private Border BuildColumn(int index)
        {
            var grid = new Grid();
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition());
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var header = new DockPanel { Margin = new Thickness(12) };
            counts[index] = Text("0", 20, Accent[index], true);
            var count = new Border { Background = Brush("#F8F4ED"), CornerRadius = new CornerRadius(8), Padding = new Thickness(10, 3, 10, 0), Child = counts[index] };
            DockPanel.SetDock(count, Dock.Right); header.Children.Add(count);
            header.Children.Add(Text(Titles[index], 20, Accent[index], true)); grid.Children.Add(header);
            cards[index] = new StackPanel { Margin = new Thickness(8, 0, 8, 8) };
            scrolls[index] = new ScrollViewer { Content = cards[index], VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, PanningMode = PanningMode.VerticalOnly };
            Grid.SetRow(scrolls[index], 1); grid.Children.Add(scrolls[index]);
            pagination[index] = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center };
            Grid.SetRow(pagination[index], 2); grid.Children.Add(pagination[index]);
            return new Border { BorderBrush = Brush("#EAE5DD"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(14),
                Margin = new Thickness(index == 0 ? 0 : 8, 0, 0, 0), Background = Brushes.White, Child = grid };
        }
        internal void Update(BoardResponse result)
        {
            snapshot = result; lastError = null; connected = true; Render();
            var newCount = result.Columns.FirstOrDefault(c => c.Stage == "new")?.Total ?? 0;
            if (automatic && !used && newCount == 0 && IsVisible) Close();
        }
        internal void SetConnected() { connected = true; }
        internal void SetError(string message) { lastError = message; connected = false; Render(); }
        internal void FinishAction(string orderId) { pending.Remove(orderId); Render(); }
        private void Render()
        {
            notice.Text = lastError ?? (snapshot == null ? "Загружаем заказы…" :
                snapshot.Columns[0].Total > 0 ? "Новый заказ · Ожидают принятия: " + snapshot.Columns[0].Total : "Все новые заказы приняты");
            notice.Foreground = Brush(lastError != null ? "#982F28" : "#69451E");
            noticeBox.Background = Brush(lastError != null ? "#FFF0ED" : "#FFF5DF");
            if (snapshot == null) return;
            for (var i = 0; i < 4; i++)
            {
                var column = snapshot.Columns.First(c => c.Stage == BoardColumn.Stages[i]);
                counts[i].Text = column.Total.ToString();
                // Rebuild only changed columns and retain their scroll position.
                var signature = string.Join("|", column.Orders.Select(o => o.Id + o.Number + o.Phone + o.Customer + o.Comment + o.ScheduledAt + o.Amount + o.PosReceiptDue + o.AutomaticReceipt + o.ReceiptError + o.CourierName + o.CourierPhone + o.CourierVehicle +
                    string.Join(";", (o.Items ?? new List<InboxItem>()).Select(item => item.Name + item.Quantity + item.Unit)))) + column.Page + ":" + column.Total + ":" + connected + ":" +
                    (column.Orders.Any(o => o.Id == confirmation) ? confirmation + confirmAction : "") + ":" + string.Join(",", column.Orders.Where(o => pending.Contains(o.Id)).Select(o => o.Id));
                if (rendered[i] == signature) continue;
                rendered[i] = signature;
                var offset = scrolls[i].VerticalOffset; cards[i].Children.Clear();
                foreach (var order in column.Orders) cards[i].Children.Add(BuildCard(order, i));
                if (column.Orders.Count == 0) cards[i].Children.Add(new Border { Padding = new Thickness(12, 36, 12, 36),
                    Child = Text(i == 3 ? "Выданных заказов за последние сутки нет" : "Заказов нет", 16, "#84796C") });
                scrolls[i].ScrollToVerticalOffset(offset);
                pagination[i].Children.Clear();
                var index = i;
                if (column.Page > 1) pagination[i].Children.Add(Button("Назад", () => PageRequested?.Invoke(index, column.Page - 1)));
                if (column.Page * 25 < column.Total) pagination[i].Children.Add(Button("Ещё", () => PageRequested?.Invoke(index, column.Page + 1)));
            }
        }
        private Border BuildCard(InboxOrder order, int stage)
        {
            var body = new StackPanel();
            body.Children.Add(Text("№" + order.Number, 30, bold: true));
            body.Children.Add(Text(order.TypeLabel, 15, Accent[stage], true));
            if (DateTimeOffset.TryParse(order.ScheduledAt, out var scheduled))
                body.Children.Add(Text("К " + scheduled.ToLocalTime().ToString("dd.MM · HH:mm"), 16, "#69451E", true));
            if (!string.IsNullOrWhiteSpace(order.Customer)) body.Children.Add(Text(order.Customer, 16));
            if (!string.IsNullOrWhiteSpace(order.Phone)) body.Children.Add(Text(order.Phone, 16, "#52483D", true));
            body.Children.Add(new Border { Height = 1, Background = Brush("#ECE6DD"), Margin = new Thickness(0, 6, 0, 12) });
            foreach (var item in order.Items ?? new List<InboxItem>())
            {
                var row = new Grid(); row.ColumnDefinitions.Add(new ColumnDefinition()); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var name = Text(item.Name, 16); name.Margin = new Thickness(0, 0, 8, 10); row.Children.Add(name);
                var amount = Text(item.Quantity.ToString("0.###", CultureInfo.GetCultureInfo("ru-RU")) + " " + (item.Unit ?? "шт."), 16, bold: true);
                amount.MaxWidth = 80; Grid.SetColumn(amount, 1); row.Children.Add(amount); body.Children.Add(row);
            }
            if (!string.IsNullOrWhiteSpace(order.Comment)) body.Children.Add(new Border { Background = Brush("#FFF8E9"),
                CornerRadius = new CornerRadius(7), Padding = new Thickness(9), Margin = new Thickness(0, 2, 0, 10), Child = Text(order.Comment, 15) });
            body.Children.Add(Text("Оплачено · " + order.Amount.ToString("0.##") + " ₸", 15, "#5F675A"));
            if (order.OrderType == "delivery" && stage > 0 && stage < 3)
            {
                var courier = string.Join("\n", new[] { order.CourierName, order.CourierPhone, order.CourierVehicle }.Where(s => !string.IsNullOrWhiteSpace(s)));
                body.Children.Add(Text(courier.Length == 0 ? "Данные курьера появятся здесь" : "Курьер\n" + courier, 15, "#385C91"));
            }
            var actions = new StackPanel { IsEnabled = connected && !pending.Contains(order.Id) };
            if (pending.Contains(order.Id)) actions.Children.Add(Text("Сохраняем…", 16));
            else if (confirmation == order.Id)
            {
                actions.Children.Add(Text(confirmAction == "reject" ? "Отклонить №" + order.Number + "? Оплата будет возвращена." : "Выдать заказ №" + order.Number + "?", 17, bold: true));
                actions.Children.Add(Button(confirmAction == "reject" ? "Да, отклонить" : "Да, заказ выдан", () => Submit(order, confirmAction), true));
                actions.Children.Add(Button("Назад", () => { confirmation = null; Render(); }));
            }
            else if (stage == 0)
            {
                actions.Children.Add(Button("Принять заказ", () => Submit(order, "accept"), true));
                actions.Children.Add(Button("Отклонить", () => Confirm(order, "reject")));
            }
            else if (stage == 1) actions.Children.Add(Button("Заказ готов", () => Submit(order, "ready"), true));
            else if (stage == 2) actions.Children.Add(Button(order.OrderType == "delivery" ? "Передать курьеру" : "Заказ выдан", () => Confirm(order, "hand_over"), true));
            else actions.Children.Add(Text(order.OrderType == "delivery" ? "Передан курьеру" : "Заказ выдан", 16, "#267147", true));
            if (order.AutomaticReceipt)
                actions.Children.Add(Text(!order.PosReceiptDue ? "Чек оформлен в iikoFront" :
                    string.IsNullOrWhiteSpace(order.ReceiptError) ? "Чек передаётся в кассу" : "Чек ожидает: " + order.ReceiptError,
                    14, order.PosReceiptDue ? "#8B5C24" : "#267147"));
            if (canImport && stage > 0 && order.PosReceiptDue && !order.AutomaticReceipt)
                actions.Children.Add(Button("Оформить чек", () => { used = true; SelectedReceiptNumber = order.Number; Close(); }));
            body.Children.Add(actions);
            var card = new Border { Padding = new Thickness(12), Margin = new Thickness(0, 0, 0, 10), BorderThickness = new Thickness(stage == 0 ? 2 : 1),
                BorderBrush = Brush(stage == 0 ? "#EAC570" : "#EAE5DD"), CornerRadius = new CornerRadius(12), Background = Brushes.White, Child = body };
            if (SystemParameters.ClientAreaAnimation)
                card.BeginAnimation(OpacityProperty, new DoubleAnimation(0.6, 1, TimeSpan.FromMilliseconds(160)));
            return card;
        }
        private void Confirm(InboxOrder order, string action) { used = true; confirmation = order.Id; confirmAction = action; Render(); }
        private void Submit(InboxOrder order, string action)
        {
            if (!pending.Add(order.Id)) return;
            used = true; confirmation = null; Render(); ActionRequested?.Invoke(order, action);
        }
    }
}
