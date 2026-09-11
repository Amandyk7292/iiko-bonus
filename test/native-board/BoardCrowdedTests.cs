using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Resto.Front.Api.IikoBonusPlugin;

internal static class BoardCrowdedTests
{
    internal static void Run(string directory)
    {
        var view = new OrderBoardWindow("19а ЖК Жасыл дала", IntPtr.Zero, false, false);
        var model = new BoardResponse { Columns = BoardColumn.Stages.Select((stage, col) => new BoardColumn {
            Stage = stage, Page = 1, Total = 80,
            Orders = Enumerable.Range(0, 25).Select(i => new InboxOrder {
                Id = col + "-" + i, Number = 100100 + col * 100 + i, Amount = 2490,
                Phone = "+7 700 000 00 00", Customer = new string('А', 300), OrderType = "pickup",
                ScheduledAt = "2026-09-11T19:00:00+05:00", Comment = "Отдельная упаковка. " + new string('Б', 2000),
                Items = Enumerable.Range(0, 20).Select(item => new InboxItem {
                    Name = "Товар " + item + " с очень длинным наименованием и описанием начинки",
                    Quantity = item == 1 ? 0.75m : 2, Unit = item == 1 ? "кг" : "шт."
                }).ToList()
            }).ToList()
        }).ToList() };
        view.Update(model);
        var root = (FrameworkElement)view.Content;
        foreach (var width in new[] { 1024, 1280 })
        {
            Layout(root, width, 768);
            var scrolls = All(root).OfType<ScrollViewer>().Where(s => s.Name.StartsWith("ColumnScroll"))
                .OrderBy(s => s.Name).ToArray();
            var headers = All(root).OfType<DockPanel>().Where(s => s.Name.StartsWith("ColumnHeader"))
                .OrderBy(s => s.Name).ToArray();
            Check(scrolls.Length == 4 && headers.Length == 4, "Four independent columns and headers");
            Check(scrolls.All(s => s.ViewportHeight > 250 && s.ViewportHeight < 768 && s.ScrollableHeight > 0), "Bounded scrollable viewport");
            var top = headers.Select(h => h.TransformToAncestor(root).Transform(new Point()).Y).ToArray();
            scrolls[0].ScrollToBottom(); root.UpdateLayout();
            Check(scrolls[0].VerticalOffset > 100 && scrolls[1].VerticalOffset == 0, "Only selected column scrolls");
            Check(headers.Select((h, i) => Math.Abs(h.TransformToAncestor(root).Transform(new Point()).Y - top[i]) < 0.1).All(x => x), "Column headings stay fixed");
            scrolls[0].ScrollToTop(); root.UpdateLayout();
            Check(Card(root, "0-0").ActualHeight < 540, "Long pending order stays compact");
            Check(Card(root, "3-0").ActualHeight < 310, "Issued order is compact");
            Directory.CreateDirectory(directory);
            var bitmap = new RenderTargetBitmap(width, 768, 96, 96, PixelFormats.Pbgra32); bitmap.Render(root);
            var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap));
            using (var output = File.Create(Path.Combine(directory, "pos-board-many-" + width + ".png"))) encoder.Save(output);
        }
        Toggle(root, "0-0"); root.UpdateLayout();
        Check(All(Card(root, "0-0")).OfType<TextBlock>().Any(t => t.Text == "Комментарий\n" + model.Columns[0].Orders[0].Comment), "Full comment available in details");
        Check(All(Card(root, "0-0")).OfType<TextBlock>().Any(t => t.Text == model.Columns[0].Orders[0].Items.Last().Name), "Full composition available in details");
        var accept = All(Card(root, "0-0")).OfType<Button>().First(b => (b.Content as TextBlock)?.Text == "Принять");
        Check(accept.TransformToAncestor(Card(root, "0-0")).Transform(new Point()).Y < 430, "Action remains above expanded details");
        view.Update(model); root.UpdateLayout();
        Check(All(Card(root, "0-0")).OfType<TextBlock>().Any(t => t.Text.StartsWith("Комментарий\n")), "Refresh preserves expansion");
        Toggle(root, "0-0"); root.UpdateLayout();
        Check(Card(root, "0-0").ActualHeight < 540, "Collapse restores compact card");
        view.Close();
        Console.WriteLine("PASS: 100 long orders; fixed headers, independent scrolling, compact history, complete expandable details and accessible actions.");
    }
    private static Border Card(DependencyObject root, string id) => All(root).OfType<Border>().First(b => (string)b.Tag == "order:" + id);
    private static void Toggle(DependencyObject root, string id) => All(root).OfType<Button>().First(b => (string)b.Tag == "details:" + id).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    private static IEnumerable<DependencyObject> All(DependencyObject root)
    {
        foreach (var item in LogicalTreeHelper.GetChildren(root)) if (item is DependencyObject child) {
            yield return child; foreach (var nested in All(child)) yield return nested;
        }
    }
    private static void Layout(FrameworkElement root, int width, int height)
    {
        root.Width = width - 36; root.Height = height - 36;
        root.Measure(new Size(width, height)); root.Arrange(new Rect(0, 0, width, height)); root.UpdateLayout();
    }
    private static void Check(bool valid, string message) { if (!valid) throw new Exception(message); }
}
