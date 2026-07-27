import ActivityKit
import Flutter
import UIKit

@available(iOS 16.2, *)
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

@main
@objc class AppDelegate: FlutterAppDelegate {
  private var orderStatusChannel: FlutterMethodChannel?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    if let controller = window?.rootViewController as? FlutterViewController {
      let channel = FlutterMethodChannel(
        name: "com.bulka.bonus/order_status",
        binaryMessenger: controller.binaryMessenger
      )
      channel.setMethodCallHandler { [weak self] call, result in
        guard let self else { return result(nil) }
        let payload = call.arguments as? [String: Any] ?? [:]
        switch call.method {
        case "updateOrderStatus":
          self.updateOrderActivity(payload)
          result(nil)
        case "clearOrderStatus":
          self.endOrderActivity(payload)
          result(nil)
        default:
          result(FlutterMethodNotImplemented)
        }
      }
      orderStatusChannel = channel
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  private func updateOrderActivity(_ payload: [String: Any]) {
    guard #available(iOS 16.2, *), ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    guard
      let orderId = payload["orderId"] as? String,
      let orderNumber = payload["orderNumber"] as? Int
    else { return }

    let content = activityContent(payload)
    if let activity = Activity<BulkaOrderActivityAttributes>.activities.first(
      where: { $0.attributes.orderId == orderId }
    ) {
      Task { await activity.update(content) }
      return
    }

    let attributes = BulkaOrderActivityAttributes(
      orderId: orderId,
      orderNumber: orderNumber,
      branch: payload["branch"] as? String ?? "",
      fulfillmentType: payload["fulfillmentType"] as? String ?? "pickup"
    )
    do {
      let activity = try Activity.request(
        attributes: attributes,
        content: content,
        pushType: .token
      )
      observePushToken(activity)
    } catch {
      NSLog("Bulka Live Activity start failed: %@", error.localizedDescription)
    }
  }

  private func endOrderActivity(_ payload: [String: Any]) {
    guard #available(iOS 16.2, *) else { return }
    let orderId = payload["orderId"] as? String
    let activities = Activity<BulkaOrderActivityAttributes>.activities.filter {
      orderId == nil || $0.attributes.orderId == orderId
    }
    let content = activityContent(payload)
    for activity in activities {
      Task {
        await activity.end(content, dismissalPolicy: .after(Date().addingTimeInterval(300)))
      }
    }
  }

  @available(iOS 16.2, *)
  private func activityContent(_ payload: [String: Any]) -> ActivityContent<BulkaOrderActivityAttributes.ContentState> {
    let etaTimestamp = (payload["etaMillis"] as? NSNumber).map { $0.doubleValue / 1000 }
    let state = BulkaOrderActivityAttributes.ContentState(
      status: payload["status"] as? String ?? "",
      orderStatus: payload["orderStatus"] as? String ?? "new",
      deliveryStatus: payload["deliveryStatus"] as? String ?? "unassigned",
      etaTimestamp: etaTimestamp,
      progress: min(1, max(0, (payload["progress"] as? NSNumber)?.doubleValue ?? 0)),
      courierName: payload["courierName"] as? String ?? "",
      updatedAtTimestamp: Date().timeIntervalSince1970
    )
    return ActivityContent(
      state: state,
      staleDate: Date().addingTimeInterval(15 * 60)
    )
  }

  @available(iOS 16.2, *)
  private func observePushToken(_ activity: Activity<BulkaOrderActivityAttributes>) {
    Task { [weak self] in
      for await tokenData in activity.pushTokenUpdates {
        let token = tokenData.map { String(format: "%02x", $0) }.joined()
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        await MainActor.run {
          self?.orderStatusChannel?.invokeMethod(
            "liveActivityToken",
            arguments: [
              "pushToken": token,
              "activityId": activity.id,
              "orderId": activity.attributes.orderId,
              "environment": environment,
            ]
          )
        }
      }
    }
  }
}
