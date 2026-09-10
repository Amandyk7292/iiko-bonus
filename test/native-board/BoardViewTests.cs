using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Resto.Front.Api.IikoBonusPlugin;
internal static class BoardViewTests
{
    [STAThread] private static void Main(string[] args)
    {
        OrderAlertTests.Run();
        var view = new OrderBoardWindow("19а ЖК Жасыл дала", IntPtr.Zero, true, false);
        var model = new BoardResponse { Columns = BoardColumn.Stages.Select((stage, i) => new BoardColumn {
            Stage = stage, Page = 1, Total = 1, Orders = new List<InboxOrder> { new InboxOrder {
                Id = "order-" + i, Number = 100042 + i, Customer = "Клиент", Phone = "+7 700 000 00 00", Amount = 2490,
                OrderType = i == 2 ? "delivery" : i == 1 ? "preorder" : "pickup", ScheduledAt = i == 1 ? "2026-09-12T10:00:00+05:00" : null,
                CourierName = i == 2 ? "Курьер" : null, CourierVehicle = i == 2 ? "Белая машина · 123 ABC" : null,
                Items = new List<InboxItem> { new InboxItem { Name = "Плюшка Московская", Quantity = 3, Unit = "шт." },
                    new InboxItem { Name = "Бауырсак вес", Quantity = 0.75m, Unit = "кг" } },
                Comment = i == 0 ? "Упакуйте, пожалуйста, отдельно" : null,
            } }
        }).ToList() };
        view.Update(model);
        model.Columns[3].Orders[0].AutomaticReceipt=true;
        model.Columns[3].Orders[0].PosReceiptDue=true;
        model.Columns[3].Orders[0].ReceiptError="Ожидается внешний тип оплаты Bulka онлайн";
        view.Update(model);
        var root = (FrameworkElement)view.Content;
        Layout(root, 1280, 800);
        var calls = new List<string>(); view.ActionRequested += (order, action) => calls.Add(order.Id + ":" + action);
        Click(root, "Принять заказ");
        Check(calls.SequenceEqual(new[] { "order-0:accept" }), "accept by card identity");
        Check(Buttons(root).All(b => Label(b) != "Принять заказ"), "duplicate acceptance disabled while pending");
        view.FinishAction("order-0"); Click(root, "Отклонить");
        Check(calls.Count == 1, "reject requires confirmation");
        Click(root, "Да, отклонить"); Check(calls.Last() == "order-0:reject", "confirmed rejection identity");
        view.FinishAction("order-0"); Click(root, "Передать курьеру");
        Click(root, "Да, заказ выдан"); Check(calls.Last() == "order-2:hand_over", "courier handover is not delivery completion");
        view.FinishAction("order-2");
        view.SetError("Нет связи. Изменение не подтверждено.");
        Check(Buttons(root).Where(b => Label(b) == "Принять заказ").All(b => !b.IsEnabled), "offline actions disabled");
        view.Update(model);
        var directory = args.Length > 0 ? args[0] : "."; Directory.CreateDirectory(directory);
        Render(root, Path.Combine(directory, "pos-board-1280.png"), 1280, 800);
        Render(root, Path.Combine(directory, "pos-board-1024.png"), 1024, 768);
        view.Close(); Console.WriteLine("PASS: acceptance, duplicate taps, rejection confirmation, code-free handover, offline actions; rendered 1280 and 1024.");
    }
    private static void Check(bool valid, string name) { if (!valid) throw new Exception(name); }
    private static string Label(Button button) => (button.Content as TextBlock)?.Text ?? "";
    private static IEnumerable<Button> Buttons(DependencyObject root)
    {
        foreach (var item in LogicalTreeHelper.GetChildren(root))
            if (item is DependencyObject child) {
                if (child is Button button) yield return button;
                foreach (var nested in Buttons(child)) yield return nested;
            }
    }
    private static void Click(DependencyObject root, string label)
    {
        var button = Buttons(root).First(b => Label(b) == label);
        Check(button.IsEnabled, label + " enabled"); button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    }
    private static void Layout(FrameworkElement root, int width, int height)
    {
        root.Width = width - 36; root.Height = height - 36;
        root.Measure(new Size(width, height)); root.Arrange(new Rect(0, 0, width, height)); root.UpdateLayout();
    }
    private static void Render(FrameworkElement root, string path, int width, int height)
    {
        Layout(root, width, height);
        var bitmap = new RenderTargetBitmap(width, height, 96, 96, PixelFormats.Pbgra32); bitmap.Render(root);
        var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using (var file = File.Create(path)) encoder.Save(file);
    }
}
