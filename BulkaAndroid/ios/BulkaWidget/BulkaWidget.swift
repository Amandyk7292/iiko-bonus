import SwiftUI
import WidgetKit
import ActivityKit
import UIKit

private let appGroupId = "group.com.bulka.bonus"

struct BulkaOrderActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        let status: String
        let orderStatus: String
        let deliveryStatus: String
        let etaTimestamp: Double?
        let progress: Double
        let courierName: String
        let updatedAtTimestamp: Double
    }

    let orderId: String
    let orderNumber: Int
    let branch: String
    let fulfillmentType: String
}

private struct BulkaWidgetEntry: TimelineEntry {
    let date: Date
    let isSignedIn: Bool
    let balance: Double
    let tier: String
    let orderNumber: Int?
    let orderStatus: String?
    let orderEta: Date?
}

private struct BulkaWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> BulkaWidgetEntry {
        BulkaWidgetEntry(
            date: Date(),
            isSignedIn: true,
            balance: 1_400,
            tier: localized("Платина", "Платина", "Platinum"),
            orderNumber: 124,
            orderStatus: "preparing",
            orderEta: Calendar.current.date(byAdding: .minute, value: 18, to: Date())
        )
    }

    func getSnapshot(
        in context: Context,
        completion: @escaping (BulkaWidgetEntry) -> Void
    ) {
        completion(readEntry())
    }

    func getTimeline(
        in context: Context,
        completion: @escaping (Timeline<BulkaWidgetEntry>) -> Void
    ) {
        let entry = readEntry()
        completion(Timeline(entries: [entry], policy: .never))
    }

    private func readEntry() -> BulkaWidgetEntry {
        let data = UserDefaults(suiteName: appGroupId)
        let orderId = data?.string(forKey: "widget_order_id")
        let number = data?.object(forKey: "widget_order_number") as? NSNumber
        return BulkaWidgetEntry(
            date: Date(),
            isSignedIn: data?.bool(forKey: "widget_is_signed_in") ?? false,
            balance: data?.double(forKey: "widget_balance") ?? 0,
            tier: data?.string(forKey: "widget_tier") ?? "",
            orderNumber: orderId == nil ? nil : number?.intValue,
            orderStatus: preferredStatus(data),
            orderEta: parseDate(data?.string(forKey: "widget_order_eta"))
        )
    }

    private func preferredStatus(_ data: UserDefaults?) -> String? {
        let delivery = data?.string(forKey: "widget_delivery_status")
        if let delivery, !delivery.isEmpty, delivery != "unassigned" {
            return delivery
        }
        return data?.string(forKey: "widget_order_status")
    }

    private func parseDate(_ value: String?) -> Date? {
        guard let value else { return nil }
        let precise = ISO8601DateFormatter()
        precise.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return precise.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

private struct BulkaWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: BulkaWidgetEntry

    private var destination: URL? {
        URL(string: entry.orderNumber == nil ? "bulka://bonus" : "bulka://orders")
    }

    var body: some View {
        Group {
            if entry.isSignedIn {
                signedInContent
            } else {
                signedOutContent
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .modifier(BulkaWidgetBackground())
        .widgetURL(destination)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityAddTraits(.isButton)
    }

    private var signedInContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Text(localized("Баланс", "Баланс", "Balance").uppercased())
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(BulkaWidgetPalette.muted)
                .padding(.top, 8)
            Text(formattedBalance(entry.balance))
                .font(.system(size: family == .systemSmall ? 26 : 29, weight: .bold, design: .rounded))
                .minimumScaleFactor(0.72)
                .lineLimit(1)
                .foregroundColor(BulkaWidgetPalette.text)
            if let number = entry.orderNumber {
                if family == .systemMedium {
                    orderCard(number)
                        .padding(.top, 8)
                } else {
                    Text(statusText(entry.orderStatus))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(BulkaWidgetPalette.gold)
                        .lineLimit(1)
                        .padding(.top, 7)
                }
            } else {
                Text(localized("Нет активных заказов", "Белсенді тапсырыс жоқ", "No active orders"))
                    .font(.system(size: 12))
                    .foregroundColor(BulkaWidgetPalette.muted)
                    .lineLimit(1)
                    .padding(.top, 7)
            }
        }
    }

    private var signedOutContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            Spacer(minLength: 4)
            Text(localized("Ваша карта Bulka", "Сіздің Bulka картаңыз", "Your Bulka card"))
                .font(.system(size: 19, weight: .bold, design: .rounded))
                .foregroundColor(BulkaWidgetPalette.text)
            Text(localized(
                "Нажмите, чтобы войти и увидеть баланс",
                "Баланс көру үшін жүйеге кіріңіз",
                "Tap to sign in and see your balance"
            ))
            .font(.system(size: 13))
            .foregroundColor(BulkaWidgetPalette.muted)
            .lineLimit(2)
            Spacer(minLength: 0)
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Bulka")
                .font(.system(size: 22, weight: .bold, design: .serif))
                .foregroundColor(BulkaWidgetPalette.text)
            Spacer(minLength: 8)
            Text(entry.tier.isEmpty ? localized("Лояльность", "Адалдық", "Loyalty") : entry.tier)
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(BulkaWidgetPalette.gold)
                .lineLimit(1)
                .textCase(.uppercase)
        }
    }

    private func orderCard(_ number: Int) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(localized("Заказ №\(number)", "№\(number) тапсырыс", "Order #\(number)"))
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(BulkaWidgetPalette.text)
                Text(orderStatusLine)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(BulkaWidgetPalette.gold)
                    .lineLimit(1)
            }
            Spacer(minLength: 6)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(BulkaWidgetPalette.gold)
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color.white.opacity(0.07))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color.white.opacity(0.14), lineWidth: 1)
        )
    }

    private var orderStatusLine: String {
        let status = statusText(entry.orderStatus)
        guard let eta = entry.orderEta else { return status }
        let formatter = DateFormatter()
        formatter.locale = widgetLocale
        formatter.dateFormat = "HH:mm"
        return localized(
            "\(status) · к \(formatter.string(from: eta))",
            "\(status) · \(formatter.string(from: eta))-ге",
            "\(status) · by \(formatter.string(from: eta))"
        )
    }

    private var accessibilityText: String {
        guard entry.isSignedIn else {
            return localized(
                "Bulka. Войдите, чтобы увидеть баланс.",
                "Bulka. Балансты көру үшін жүйеге кіріңіз.",
                "Bulka. Sign in to see your balance."
            )
        }
        let balance = formattedBalance(entry.balance)
        guard let number = entry.orderNumber else {
            return localized(
                "Баланс Bulka: \(balance). Нажмите, чтобы открыть.",
                "Bulka балансы: \(balance). Ашу үшін басыңыз.",
                "Bulka balance: \(balance). Tap to open."
            )
        }
        return localized(
            "Баланс Bulka: \(balance). Заказ №\(number): \(statusText(entry.orderStatus)). Нажмите, чтобы открыть.",
            "Bulka балансы: \(balance). №\(number) тапсырыс: \(statusText(entry.orderStatus)). Ашу үшін басыңыз.",
            "Bulka balance: \(balance). Order #\(number): \(statusText(entry.orderStatus)). Tap to open."
        )
    }
}

private struct BulkaWidgetBackground: ViewModifier {
    private var gradient: some View {
        LinearGradient(
            colors: [Color(red: 0.29, green: 0.14, blue: 0.08), Color(red: 0.12, green: 0.06, blue: 0.04)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            content.containerBackground(for: .widget) { gradient }
        } else {
            content.background(gradient)
        }
    }
}

private enum BulkaWidgetPalette {
    static let text = Color(red: 1.00, green: 0.98, blue: 0.94)
    static let muted = Color(red: 0.84, green: 0.76, blue: 0.71)
    static let gold = Color(red: 0.96, green: 0.80, blue: 0.38)
}

private var widgetLocale: Locale {
    guard let language = UserDefaults(suiteName: appGroupId)?.string(forKey: "widget_language"),
          ["ru", "kk", "en"].contains(language) else { return Locale.current }
    return Locale(identifier: language)
}

private func localized(_ russian: String, _ kazakh: String, _ english: String) -> String {
    switch widgetLocale.languageCode {
    case "ru": return russian
    case "kk": return kazakh
    default: return english
    }
}

private func formattedBalance(_ value: Double) -> String {
    let formatter = NumberFormatter()
    formatter.locale = widgetLocale
    formatter.numberStyle = .decimal
    formatter.minimumFractionDigits = 0
    formatter.maximumFractionDigits = value.rounded() == value ? 0 : 2
    return "\(formatter.string(from: NSNumber(value: value)) ?? "0") ₸"
}

private func statusText(_ raw: String?) -> String {
    switch raw?.lowercased() {
    case "created", "new", "payment_pending":
        return localized("Заказ получен", "Тапсырыс қабылданды", "Order received")
    case "paid", "accepted", "confirmed", "queued":
        return localized("Заказ подтверждён", "Тапсырыс расталды", "Order confirmed")
    case "preparing", "cooking":
        return localized("Готовим", "Дайындалып жатыр", "Preparing")
    case "ready", "ready_for_pickup":
        return localized("Можно забирать", "Алып кетуге дайын", "Ready for pickup")
    case "handed_over", "picked_up":
        return localized("Заказ передан", "Тапсырыс берілді", "Handed over")
    case "on_the_way", "in_transit", "en_route":
        return localized("Курьер в пути", "Курьер жолда", "On the way")
    case "completed":
        return localized("Заказ завершён", "Тапсырыс аяқталды", "Order complete")
    case "delivered":
        return localized("Доставлен", "Жеткізілді", "Delivered")
    case "cancelled", "canceled":
        return localized("Отменён", "Бас тартылды", "Cancelled")
    default:
        return localized("Заказ активен", "Тапсырыс белсенді", "Order is active")
    }
}

struct BulkaHomeWidget: Widget {
    let kind = "BulkaHomeWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BulkaWidgetProvider()) { entry in
            BulkaWidgetView(entry: entry)
        }
        .configurationDisplayName(localized("Bulka: баланс и заказ", "Bulka: баланс және тапсырыс", "Bulka: balance and order"))
        .description(localized("Баланс бонусов и статус заказа всегда рядом.", "Бонус балансы мен тапсырыс күйі әрдайым көрінеді.", "Your loyalty balance and order status at a glance."))
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct BulkaOrderLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: BulkaOrderActivityAttributes.self) { context in
            BulkaLiveOrderView(context: context)
                .activityBackgroundTint(Color(red: 0.18, green: 0.09, blue: 0.05))
                .activitySystemActionForegroundColor(BulkaWidgetPalette.gold)
                .widgetURL(URL(string: "bulka://orders"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    BulkaWordmark(width: 58)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    liveEta(context.state.etaTimestamp.map(Date.init(timeIntervalSince1970:)), compact: true, status: liveOrderStatus(context.state))
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(localized(
                        "Заказ №\(context.attributes.orderNumber)",
                        "№\(context.attributes.orderNumber) тапсырыс",
                        "Order #\(context.attributes.orderNumber)"
                    ))
                    .font(.system(size: 14, weight: .bold))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 7) {
                        HStack {
                            Label(statusText(liveOrderStatus(context.state)), systemImage: liveStatusIcon(liveOrderStatus(context.state)))
                                .font(.system(size: 13, weight: .semibold))
                            Spacer()
                            if !context.state.courierName.isEmpty {
                                Text(context.state.courierName)
                                    .font(.system(size: 12))
                                    .foregroundStyle(.secondary)
                            }
                        }
                        ProgressView(value: context.state.progress)
                            .tint(BulkaWidgetPalette.gold)
                    }
                }
            } compactLeading: {
                Image(systemName: liveStatusIcon(liveOrderStatus(context.state)))
                    .foregroundStyle(BulkaWidgetPalette.gold)
            } compactTrailing: {
                liveEta(context.state.etaTimestamp.map(Date.init(timeIntervalSince1970:)), compact: true, status: liveOrderStatus(context.state))
            } minimal: {
                Image(systemName: liveStatusIcon(liveOrderStatus(context.state)))
                    .foregroundStyle(BulkaWidgetPalette.gold)
            }
            .widgetURL(URL(string: "bulka://orders"))
            .keylineTint(BulkaWidgetPalette.gold)
        }
    }
}

private struct BulkaWordmark: View {
    let width: CGFloat
    // Bounds of the official transparent wordmark in the bundled 1000x350
    // source. Cropping in the view preserves the original brand asset.
    private static let wordmark: UIImage? = {
        guard let source = UIImage(named: "BulkaLogo")?.cgImage,
              let cropped = source.cropping(to: CGRect(x: 305, y: 73, width: 391, height: 212))
        else { return nil }
        return UIImage(cgImage: cropped)
    }()

    var body: some View {
        Group {
            if let image = Self.wordmark {
                Image(uiImage: image)
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(.white)
            }
        }
        .frame(width: width, height: width * 212 / 391)
        .accessibilityLabel("Bulka")
    }
}

private func liveOrderStatus(_ state: BulkaOrderActivityAttributes.ContentState) -> String {
    if ["completed", "cancelled"].contains(state.orderStatus) { return state.orderStatus }
    if ["picked_up", "en_route", "delivered"].contains(state.deliveryStatus) { return state.deliveryStatus }
    return state.orderStatus
}

private func liveStatusIcon(_ status: String) -> String {
    switch status {
    case "accepted", "confirmed": return "checkmark.seal.fill"
    case "preparing", "cooking": return "flame.fill"
    case "ready", "ready_for_pickup": return "shippingbox.fill"
    case "picked_up", "en_route": return "scooter"
    case "delivered", "completed": return "checkmark.circle.fill"
    case "cancelled", "canceled": return "xmark.circle.fill"
    default: return "bag.fill"
    }
}

private struct BulkaLiveOrderView: View {
    let context: ActivityViewContext<BulkaOrderActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center) {
                BulkaWordmark(width: 64)
                Spacer(minLength: 12)
                Text(localized(
                    "Заказ №\(context.attributes.orderNumber)",
                    "№\(context.attributes.orderNumber) тапсырыс",
                    "Order #\(context.attributes.orderNumber)"
                ))
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(BulkaWidgetPalette.gold)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            }
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: liveStatusIcon(liveOrderStatus(context.state)))
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(BulkaWidgetPalette.gold)
                    .frame(width: 36, height: 36)
                    .background(RoundedRectangle(cornerRadius: 11).fill(Color.white.opacity(0.08)))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(statusText(liveOrderStatus(context.state)))
                        .font(.system(size: 18, weight: .bold, design: .rounded))
                        .foregroundStyle(BulkaWidgetPalette.text)
                        .fixedSize(horizontal: false, vertical: true)
                    if !context.attributes.branch.isEmpty {
                        Text(context.attributes.branch)
                            .font(.system(size: 12))
                            .foregroundStyle(BulkaWidgetPalette.muted)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            if ["new", "accepted", "preparing", "picked_up", "en_route"].contains(liveOrderStatus(context.state)) {
                HStack(spacing: 6) {
                    Image(systemName: "clock")
                    liveEta(context.state.etaTimestamp.map(Date.init(timeIntervalSince1970:)), compact: false, status: liveOrderStatus(context.state))
                }
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(BulkaWidgetPalette.gold)
            }
            ProgressView(value: context.state.progress)
                .tint(BulkaWidgetPalette.gold)
                .background(Color.white.opacity(0.14))
                .clipShape(Capsule())
        }
        .padding(14)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(localized(
            "Заказ №\(context.attributes.orderNumber). \(statusText(liveOrderStatus(context.state)))",
            "№\(context.attributes.orderNumber) тапсырыс. \(statusText(liveOrderStatus(context.state)))",
            "Order #\(context.attributes.orderNumber). \(statusText(liveOrderStatus(context.state)))"
        ))
    }
}

@ViewBuilder
private func liveEta(_ eta: Date?, compact: Bool, status: String) -> some View {
    if ["ready", "completed", "delivered", "cancelled"].contains(status) {
        Text(status == "ready" ? localized("Готов", "Дайын", "Ready") : localized("Завершён", "Аяқталды", "Ended"))
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(BulkaWidgetPalette.gold)
    } else if let eta, eta > Date() {
        Text(timerInterval: Date()...eta, countsDown: true)
            .monospacedDigit()
            .font(.system(size: compact ? 12 : 14, weight: .semibold, design: .rounded))
            .foregroundStyle(BulkaWidgetPalette.gold)
    } else {
        Text(compact ? localized("Уточняем", "Нақтылауда", "Updating") : localized("Уточняем время готовности", "Дайын болу уақытын нақтылауда", "Confirming the time"))
            .font(.system(size: compact ? 12 : 13, weight: .medium, design: .rounded))
            .foregroundStyle(BulkaWidgetPalette.gold)
    }
}

@main
struct BulkaWidgetBundle: WidgetBundle {
    var body: some Widget {
        BulkaHomeWidget()
        BulkaOrderLiveActivity()
    }
}
