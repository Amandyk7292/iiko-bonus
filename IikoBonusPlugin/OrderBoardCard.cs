using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal sealed partial class OrderBoardWindow
    {
        private static TextBlock Preview(string value, double size = 15, int lines = 1,
            string color = "#52483D", bool bold = false)
        {
            var text = Text(value, size, color, bold);
            text.LineHeight = size * 1.4;
            text.MaxHeight = text.LineHeight * lines;
            text.TextTrimming = TextTrimming.CharacterEllipsis;
            text.Margin = new Thickness(0, 0, 0, 5);
            return text;
        }

        private static Grid ItemRow(InboxItem item, bool compact)
        {
            var row = new Grid();
            row.ColumnDefinitions.Add(new ColumnDefinition());
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var name = compact ? Preview(item.Name, 15) : Text(item.Name, 15);
            name.Margin = new Thickness(0, 0, 8, 8);
            row.Children.Add(name);
            var amount = Text(item.Quantity.ToString("0.###", CultureInfo.GetCultureInfo("ru-RU")) +
                " " + (item.Unit ?? "шт."), 15, bold: true);
            amount.MaxWidth = 78;
            Grid.SetColumn(amount, 1); row.Children.Add(amount);
            return row;
        }

        private Border BuildCard(InboxOrder order, int stage)
        {
            var body = new StackPanel();
            var items = order.Items ?? new List<InboxItem>();
            var isExpanded = expanded.Contains(order.Id);
            body.Children.Add(Text("№" + order.Number, stage == 3 ? 23 : 27, bold: true));
            var subtitle = order.TypeLabel;
            if (DateTimeOffset.TryParse(order.ScheduledAt, out var scheduled))
                subtitle += "\nК " + scheduled.ToLocalTime().ToString("dd.MM · HH:mm");
            body.Children.Add(Preview(subtitle, 14, 3, Accent[stage], true));
            if (stage < 3)
            {
                if (!string.IsNullOrWhiteSpace(order.Phone)) body.Children.Add(Text(order.Phone, 15, bold: true));
                body.Children.Add(new Border { Height = 1, Background = Brush("#ECE6DD"), Margin = new Thickness(0, 2, 0, 8) });
                foreach (var item in items.Take(2)) body.Children.Add(ItemRow(item, true));
                if (items.Count > 2) body.Children.Add(Text("Ещё позиций: " + (items.Count - 2), 14, "#8A501C", true));
                if (!string.IsNullOrWhiteSpace(order.Comment))
                    body.Children.Add(Preview("Комментарий: " + order.Comment, 14, 1, "#8A501C"));
            }
            else body.Children.Add(Text("Позиций: " + items.Count, 14, "#746A60"));
            body.Children.Add(Text("Оплачено · " + order.Amount.ToString("0.##") + " ₸", 14, "#5F675A"));
            if (order.OrderType == "delivery" && stage > 0 && stage < 3)
                body.Children.Add(Preview(string.IsNullOrWhiteSpace(order.CourierName)
                    ? "Курьер пока не назначен" : "Курьер: " + order.CourierName, 14, 1, "#385C91"));
            // Primary actions stay above expanded details, including orders with
            // dozens of lines or a long customer comment.
            body.Children.Add(BuildActions(order, stage));
            var toggle = Button(isExpanded ? "Свернуть" : "Подробнее", () => {
                used = true;
                if (!expanded.Add(order.Id)) expanded.Remove(order.Id);
                Render();
            });
            toggle.Tag = "details:" + order.Id;
            body.Children.Add(toggle);
            if (isExpanded) body.Children.Add(BuildDetails(order, items));
            return new Border { Tag = "order:" + order.Id, Padding = new Thickness(12),
                Margin = new Thickness(0, 0, 0, 10), BorderThickness = new Thickness(stage == 0 ? 2 : 1),
                BorderBrush = Brush(stage == 0 ? "#EAC570" : "#EAE5DD"), CornerRadius = new CornerRadius(12),
                Background = Brushes.White, Child = body };
        }

        private StackPanel BuildActions(InboxOrder order, int stage)
        {
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
                var choices = new Grid();
                choices.ColumnDefinitions.Add(new ColumnDefinition());
                choices.ColumnDefinitions.Add(new ColumnDefinition());
                var accept = Button("Принять", () => Submit(order, "accept"), true);
                var reject = Button("Отклонить", () => Confirm(order, "reject"));
                foreach (var choice in new[] { accept, reject }) {
                    choice.Padding = new Thickness(4, 9, 4, 9); choice.FontSize = 14;
                    ((TextBlock)choice.Content).TextWrapping = TextWrapping.NoWrap;
                }
                choices.Children.Add(accept);
                Grid.SetColumn(reject, 1); choices.Children.Add(reject); actions.Children.Add(choices);
            }
            else if (stage == 1) actions.Children.Add(Button("Заказ готов", () => Submit(order, "ready"), true));
            else if (stage == 2) actions.Children.Add(Button(order.OrderType == "delivery" ? "Передать курьеру" : "Заказ выдан", () => Confirm(order, "hand_over"), true));
            else actions.Children.Add(Text(order.OrderType == "delivery" ? "Передан курьеру" : "Заказ выдан", 15, "#267147", true));
            if (order.AutomaticReceipt)
                actions.Children.Add(Preview(!order.PosReceiptDue ? "Чек оформлен в iikoFront" :
                    string.IsNullOrWhiteSpace(order.ReceiptError) ? "Чек передаётся в кассу" : "Чек ожидает: " + order.ReceiptError,
                    14, 3, order.PosReceiptDue ? "#8B5C24" : "#267147"));
            if (canImport && stage > 0 && order.PosReceiptDue && !order.AutomaticReceipt)
                actions.Children.Add(Button("Оформить чек", () => { used = true; SelectedReceiptNumber = order.Number; Close(); }));
            return actions;
        }

        private static StackPanel BuildDetails(InboxOrder order, List<InboxItem> items)
        {
            var details = new StackPanel { Margin = new Thickness(0, 8, 0, 0) };
            if (!string.IsNullOrWhiteSpace(order.Customer)) details.Children.Add(Text(order.Customer, 15));
            if (!string.IsNullOrWhiteSpace(order.Phone)) details.Children.Add(Text(order.Phone, 15, bold: true));
            details.Children.Add(Text("Состав заказа", 15, bold: true));
            foreach (var item in items) details.Children.Add(ItemRow(item, false));
            if (!string.IsNullOrWhiteSpace(order.Comment))
                details.Children.Add(Text("Комментарий\n" + order.Comment, 15, "#8A501C"));
            var courier = string.Join("\n", new[] { order.CourierName, order.CourierPhone, order.CourierVehicle }
                .Where(s => !string.IsNullOrWhiteSpace(s)));
            if (courier.Length > 0) details.Children.Add(Text("Курьер\n" + courier, 15, "#385C91"));
            if (order.PosReceiptDue && !string.IsNullOrWhiteSpace(order.ReceiptError))
                details.Children.Add(Text("Чек ожидает: " + order.ReceiptError, 14, "#8B5C24"));
            return details;
        }
    }
}
