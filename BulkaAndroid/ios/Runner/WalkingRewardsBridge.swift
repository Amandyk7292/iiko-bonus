import CoreMotion
import CryptoKit
import DeviceCheck
import Flutter
import Security
import UIKit

/// Only Core Motion measurements are signed. Dart cannot supply a step total.
final class WalkingRewardsBridge {
  private let pedometer = CMPedometer()
  private let service = DCAppAttestService.shared
  private var busy = false
  private let keyPreference = "bulka.walking.attest-key.v1"

  func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    if call.method == "capabilities" {
      result(["supported": CMPedometer.isStepCountingAvailable() && service.isSupported,
              "authorized": CMPedometer.authorizationStatus() == .authorized])
      return
    }
    if call.method == "openSettings" {
      guard let url = URL(string: UIApplication.openSettingsURLString) else { return result(false) }
      UIApplication.shared.open(url)
      result(true)
      return
    }
    guard ["identity", "attest", "measure"].contains(call.method) else {
      return result(FlutterMethodNotImplemented)
    }
    guard CMPedometer.isStepCountingAvailable(), service.isSupported else {
      return result(FlutterError(code: "WALKING_UNSUPPORTED", message: nil, details: nil))
    }
    guard !busy else { return result(FlutterError(code: "WALKING_BUSY", message: nil, details: nil)) }
    busy = true
    let args = call.arguments as? [String: Any] ?? [:]
    Task {
      do {
        let value = try await run(call.method, args)
        await MainActor.run { self.busy = false; result(value) }
      } catch {
        if (error as NSError).domain == DCErrorDomain,
           (error as NSError).code == DCError.Code.invalidKey.rawValue {
          UserDefaults.standard.removeObject(forKey: keyPreference)
        }
        let denied = CMPedometer.authorizationStatus() == .denied || CMPedometer.authorizationStatus() == .restricted
        let code = (error as NSError).domain == CMErrorDomain && denied ? "WALKING_PERMISSION" : "WALKING_DEVICE_ERROR"
        await MainActor.run { self.busy = false; result(FlutterError(code: code, message: nil, details: nil)) }
      }
    }
  }

  private func run(_ method: String, _ args: [String: Any]) async throws -> Any {
    let deviceId = try stableDeviceId()
    let keyId: String
    if let saved = UserDefaults.standard.string(forKey: keyPreference) { keyId = saved }
    else {
      keyId = try await service.generateKey()
      UserDefaults.standard.set(keyId, forKey: keyPreference)
    }
    if method == "identity" { return ["deviceId": deviceId, "keyId": keyId] }
    guard args["keyId"] as? String == keyId,
          args["deviceId"] as? String == deviceId,
          let challenge = args["challenge"] as? String, !challenge.isEmpty else { throw invalid() }
    if method == "attest" {
      do {
        let hash = Data(SHA256.hash(data: Data(challenge.utf8)))
        let attestation = try await service.attestKey(keyId, clientDataHash: hash)
        return ["attestation": attestation.base64EncodedString()]
      } catch {
        // An interrupted registration can consume an Apple attestation without
        // reaching our server. Rotate only this app key; the device ID survives.
        if (error as NSError).domain == DCErrorDomain,
           (error as NSError).code == DCError.Code.invalidKey.rawValue {
          UserDefaults.standard.removeObject(forKey: keyPreference)
        }
        throw error
      }
    }
    let period = try Self.validatePeriod(args, now: Date())
    let steps = try await querySteps(from: period.start, to: period.end)
    guard steps >= 0, steps <= 150000 else { throw invalid() }
    let fields: [String: Any] = ["challenge": challenge, "date": period.date,
      "source": "ios_core_motion", "steps": steps,
      "startAt": args["startAt"]!, "endAt": args["endAt"]!]
    let payload = try JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys, .withoutEscapingSlashes])
    let assertion = try await service.generateAssertion(keyId, clientDataHash: Data(SHA256.hash(data: payload)))
    return ["payload": String(decoding: payload, as: UTF8.self), "assertion": assertion.base64EncodedString()]
  }

  static func validatePeriod(_ args: [String: Any], now: Date) throws -> (start: Date, end: Date, date: String) {
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let startText = args["startAt"] as? String, let endText = args["endAt"] as? String,
          let date = args["date"] as? String, let start = parser.date(from: startText),
          let end = parser.date(from: endText) else { throw NSError(domain: "WalkingPeriod", code: 1) }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 5 * 3600)!
    let dayStart = calendar.startOfDay(for: start)
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "yyyy-MM-dd"
    guard dayStart == start, formatter.string(from: start) == date, end > start,
          end.timeIntervalSince(start) <= 86400,
          end.timeIntervalSince(now) <= 30,
          now.timeIntervalSince(start) <= 7 * 86400 else { throw NSError(domain: "WalkingPeriod", code: 1) }
    return (start, end, date)
  }

  private func querySteps(from: Date, to: Date) async throws -> Int {
    try await withCheckedThrowingContinuation { continuation in
      pedometer.queryPedometerData(from: from, to: to) { data, error in
        if let error { continuation.resume(throwing: error) }
        else if let data { continuation.resume(returning: data.numberOfSteps.intValue) }
        else { continuation.resume(throwing: self.invalid()) }
      }
    }
  }

  private func invalid() -> NSError { NSError(domain: "WalkingProof", code: 1) }
  private func stableDeviceId() throws -> String {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "com.bulka.bonus.walking-device.v1", kSecAttrAccount as String: "device"]
    var value: CFTypeRef?
    var lookup = query
    lookup[kSecReturnData as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    let status = SecItemCopyMatching(lookup as CFDictionary, &value)
    if status == errSecSuccess, let data = value as? Data,
       let id = String(data: data, encoding: .utf8), id.count == 64 { return id }
    guard status == errSecItemNotFound else { throw invalid() }
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw invalid() }
    let id = bytes.map { String(format: "%02x", $0) }.joined()
    var insert = query
    insert[kSecValueData as String] = Data(id.utf8)
    insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { throw invalid() }
    return id
  }
}
