"""Create an ephemeral App Store profile after enabling a required capability."""

import base64
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request


API = "https://api.appstoreconnect.apple.com/v1"
BUNDLE_ID = "com.bulka.bonus"


def b64url(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def read_length(data, offset):
    length = data[offset]
    offset += 1
    if length & 0x80:
        count = length & 0x7F
        length = int.from_bytes(data[offset : offset + count], "big")
        offset += count
    return length, offset


def ecdsa_der_to_raw(signature, part_size=32):
    offset = 0
    if signature[offset] != 0x30:
        raise ValueError("Unexpected ECDSA signature")
    _, offset = read_length(signature, offset + 1)
    values = []
    for _ in range(2):
        if signature[offset] != 0x02:
            raise ValueError("Unexpected ECDSA integer")
        length, offset = read_length(signature, offset + 1)
        value = signature[offset : offset + length]
        offset += length
        value = value.lstrip(b"\0")
        if len(value) > part_size:
            raise ValueError("ECDSA integer is too large")
        values.append(value.rjust(part_size, b"\0"))
    return b"".join(values)


def private_key_bytes():
    value = os.environ["ASC_PRIVATE_KEY"].strip()
    if "BEGIN PRIVATE KEY" in value:
        return value.replace("\\n", "\n").encode("utf-8")
    return base64.b64decode(value, validate=True)


def token(key_path):
    now = int(time.time())
    header = b64url(
        json.dumps(
            {"alg": "ES256", "kid": os.environ["ASC_KEY_ID"], "typ": "JWT"},
            separators=(",", ":"),
        ).encode("utf-8")
    )
    payload = b64url(
        json.dumps(
            {
                "iss": os.environ["ASC_ISSUER_ID"],
                "iat": now - 30,
                "exp": now + 900,
                "aud": "appstoreconnect-v1",
            },
            separators=(",", ":"),
        ).encode("utf-8")
    )
    signing_input = f"{header}.{payload}".encode("ascii")
    signed = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", str(key_path)],
        input=signing_input,
        check=True,
        capture_output=True,
    ).stdout
    return f"{header}.{payload}.{b64url(ecdsa_der_to_raw(signed))}"


class AppleApi:
    def __init__(self, bearer):
        self.bearer = bearer

    def request(self, method, path, body=None):
        payload = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            API + path,
            data=payload,
            method=method,
            headers={
                "Authorization": f"Bearer {self.bearer}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                content = response.read()
                return {} if not content else json.loads(content)
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:2000]
            raise RuntimeError(f"Apple API {method} {path} returned {error.code}: {detail}") from None


def decode_profile(content, target):
    target.write_bytes(base64.b64decode(content, validate=True))
    decoded = subprocess.run(
        ["security", "cms", "-D", "-i", str(target)],
        check=True,
        capture_output=True,
    ).stdout
    return plistlib.loads(decoded)


def current_profile(temp):
    return decode_profile(os.environ["IOS_APP_PROFILE"], temp / "current.mobileprovision")


def find_bundle(api):
    query = urllib.parse.urlencode(
        {"filter[identifier]": BUNDLE_ID, "include": "bundleIdCapabilities", "limit": "1"}
    )
    response = api.request("GET", f"/bundleIds?{query}")
    if len(response.get("data", [])) != 1:
        raise RuntimeError(f"Apple Bundle ID not found: {BUNDLE_ID}")
    return response["data"][0], response.get("included", [])


def enable_healthkit(api, bundle, included):
    enabled = {
        item.get("attributes", {}).get("capabilityType")
        for item in included
        if item.get("type") == "bundleIdCapabilities"
    }
    if "HEALTHKIT" in enabled:
        return
    api.request(
        "POST",
        "/bundleIdCapabilities",
        {
            "data": {
                "type": "bundleIdCapabilities",
                "attributes": {"capabilityType": "HEALTHKIT"},
                "relationships": {
                    "bundleId": {"data": {"type": "bundleIds", "id": bundle["id"]}}
                },
            }
        },
    )


def source_profile_id(api, profile):
    query = urllib.parse.urlencode({"filter[name]": profile["Name"], "limit": "20"})
    response = api.request("GET", f"/profiles?{query}")
    matches = [
        item
        for item in response.get("data", [])
        if item.get("attributes", {}).get("uuid") == profile["UUID"]
    ]
    if len(matches) != 1:
        raise RuntimeError("Current App Store profile was not found in Apple Developer")
    return matches[0]["id"]


def certificate_ids(api, profile_id):
    response = api.request("GET", f"/profiles/{profile_id}/relationships/certificates?limit=200")
    result = [item["id"] for item in response.get("data", [])]
    if not result:
        raise RuntimeError("Current App Store profile has no distribution certificate")
    return result


def create_profile(api, bundle_id, certificates):
    name = f"Bulka App Store HealthKit {os.environ.get('GITHUB_RUN_ID', int(time.time()))}"
    body = {
        "data": {
            "type": "profiles",
            "attributes": {"name": name, "profileType": "IOS_APP_STORE"},
            "relationships": {
                "bundleId": {"data": {"type": "bundleIds", "id": bundle_id}},
                "certificates": {
                    "data": [
                        {"type": "certificates", "id": certificate_id}
                        for certificate_id in certificates
                    ]
                },
            },
        }
    }
    last_error = None
    for attempt in range(5):
        try:
            return api.request("POST", "/profiles", body)["data"]["attributes"]["profileContent"]
        except RuntimeError as error:
            last_error = error
            if attempt == 4:
                break
            time.sleep(5)
    raise last_error


def export_profile(content):
    github_env = Path(os.environ["GITHUB_ENV"])
    with github_env.open("a", encoding="utf-8") as output:
        output.write(f"IOS_APP_PROFILE={content}\n")


def main():
    for name in ["ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_PRIVATE_KEY", "IOS_APP_PROFILE", "GITHUB_ENV"]:
        if not os.environ.get(name):
            raise RuntimeError(f"Missing required environment value: {name}")
    with tempfile.TemporaryDirectory() as directory:
        temp = Path(directory)
        key_path = temp / "AuthKey.p8"
        key_path.write_bytes(private_key_bytes())
        key_path.chmod(0o600)
        profile = current_profile(temp)
        api = AppleApi(token(key_path))
        bundle, included = find_bundle(api)
        source_id = source_profile_id(api, profile)
        certificates = certificate_ids(api, source_id)
        enable_healthkit(api, bundle, included)
        content = create_profile(api, bundle["id"], certificates)
        refreshed = decode_profile(content, temp / "healthkit.mobileprovision")
        if refreshed.get("Entitlements", {}).get("com.apple.developer.healthkit") is not True:
            raise RuntimeError("Generated profile is missing the HealthKit entitlement")
        export_profile(content)
    print("Generated an ephemeral App Store profile with HealthKit enabled.")


if __name__ == "__main__":
    main()
