require 'minitest/autorun'
require 'tmpdir'
require_relative '../scripts/ios-signing-audit'

class IosSigningAuditTest < Minitest::Test
  NOW = Time.utc(2026, 10, 4)

  def profile
    { 'id' => 'profile-id', 'attributes' => {
      'name' => 'BulkaAppStore', 'uuid' => 'uuid', 'profileState' => 'ACTIVE',
      'profileType' => 'IOS_APP_STORE', 'expirationDate' => '2027-09-13T00:00:00Z',
      'profileContent' => 'RAW_PROFILE_MUST_NOT_LEAK', 'unexpected' => 'PRIVATE_UNKNOWN_FIELD'
    } }
  end

  def certificate
    { 'id' => 'cert-id', 'attributes' => {
      'certificateType' => 'DISTRIBUTION', 'expirationDate' => '2027-09-13T00:00:00Z',
      'activated' => true, 'certificateContent' => 'RAW_CERTIFICATE_MUST_NOT_LEAK'
    } }
  end

  def decoded
    { 'Name' => 'BulkaAppStore', 'UUID' => 'uuid', 'TeamIdentifier' => ['TEAM'], 'ApplicationIdentifierPrefix' => ['LEGACY'],
      'ProvisionedDevicesPresent' => false, 'ProvisionedDeviceCount' => 0,
      'Entitlements' => {
        'application-identifier' => 'LEGACY.com.bulka.bonus',
        'com.apple.developer.team-identifier' => 'TEAM', 'get-task-allow' => false,
        'com.apple.developer.devicecheck.appattest-environment' => 'production',
        'aps-environment' => 'production',
        'com.apple.developer.associated-domains' => ['*'],
        'com.apple.security.application-groups' => ['group.com.bulka.bonus'],
        'unknown-secret' => 'PRIVATE_ENTITLEMENT_MUST_NOT_LEAK'
      } }
  end

  def summary(p = profile, c = certificate, d = decoded)
    IosSigningAudit.profile_summary(p, [c], d, 'com.bulka.bonus',
                                   IosSigningAudit::BUNDLES.fetch('com.bulka.bonus'), NOW)
  end

  def test_valid_store_profile_supports_legacy_prefix_and_associated_domain_wildcard
    result = summary
    assert result[:usableForRequestedAppStoreEntitlements]
    assert result[:bundleIdentifierMatches]
    assert result[:teamIdentifierMatches]
  end

  def test_old_profile_missing_app_attest_is_identified_without_weakening_requirement
    d = decoded
    d['Entitlements'].delete('com.apple.developer.devicecheck.appattest-environment')
    result = summary(profile, certificate, d)
    refute result[:usableForRequestedAppStoreEntitlements]
    refute result[:requiredEntitlements]['com.apple.developer.devicecheck.appattest-environment']
    assert_equal 'production', IosSigningAudit::BUNDLES['com.bulka.bonus']['com.apple.developer.devicecheck.appattest-environment']
  end

  def test_profile_bytes_certificate_bytes_and_unknown_fields_are_never_published
    report = JSON.generate(summary)
    refute_match(/MUST_NOT_LEAK|PRIVATE_UNKNOWN_FIELD|profileContent|certificateContent|unknown-secret/, report)
  end

  def test_expired_inactive_or_non_distribution_certificate_is_not_usable
    ['expirationDate', 'activated', 'certificateType'].each do |field|
      c = certificate
      c['attributes'][field] = { 'expirationDate' => '2026-09-13T00:00:00Z',
                                'activated' => false, 'certificateType' => 'DEVELOPMENT' }.fetch(field)
      refute summary(profile, c)[:usableForRequestedAppStoreEntitlements]
    end
  end

  def test_wrong_bundle_team_uuid_or_debug_profile_is_not_usable
    d = decoded
    d['UUID'] = 'other-uuid'
    refute summary(profile, certificate, d)[:usableForRequestedAppStoreEntitlements]
    d = decoded
    d['Name'] = 'OldProfileNameBeforeRegeneration'
    refute summary(profile, certificate, d)[:usableForRequestedAppStoreEntitlements]
    d = decoded
    d['Entitlements']['com.apple.developer.team-identifier'] = 'OTHER'
    refute summary(profile, certificate, d)[:usableForRequestedAppStoreEntitlements]
    d = decoded
    d['Entitlements']['application-identifier'] = 'LEGACY.com.other.app'
    refute summary(profile, certificate, d)[:usableForRequestedAppStoreEntitlements]
    d = decoded
    d['Entitlements']['get-task-allow'] = true
    refute summary(profile, certificate, d)[:usableForRequestedAppStoreEntitlements]
  end

  def test_device_or_enterprise_profile_is_not_app_store_usable
    d = decoded
    d['ProvisionedDevicesPresent'] = true
    d['ProvisionedDeviceCount'] = 2
    result = summary(profile, certificate, d)
    refute result[:usableForRequestedAppStoreEntitlements]
    assert_equal 2, result[:provisionedDeviceCount]
    d = decoded
    d['ProvisionsAllDevices'] = true
    refute summary(profile, certificate, d)[:usableForRequestedAppStoreEntitlements]
  end

  def test_api_failure_produces_partial_sanitized_report
    client = Object.new
    def client.list(_path, _query)
      raise IosSigningAudit::AuditError.new('APPLE_API_ERROR', path: '/v1/bundleIds', status: 403)
    end
    result = IosSigningAudit.audit(client, now: NOW)
    refute result[:complete]
    assert result[:readOnly]
    assert_equal [{ code: 'APPLE_API_ERROR', path: '/v1/bundleIds', status: 403 }], result[:errors]
  end

  def test_unexpected_error_message_is_not_emitted
    client = Object.new
    def client.list(_path, _query)
      raise 'PRIVATE_SERVER_PAYLOAD_MUST_NOT_LEAK'
    end
    result = IosSigningAudit.audit(client, now: NOW)
    refute result[:complete]
    refute_match(/MUST_NOT_LEAK/, JSON.generate(result))
  end

  def test_invalid_pagination_cannot_forward_bearer_to_another_host
    client = IosSigningAudit::Client.new('DUMMY_TOKEN')
    client.define_singleton_method(:read) do |_uri|
      { 'data' => [], 'links' => { 'next' => 'https://other.example/v1/bundleIds' } }
    end
    error = assert_raises(IosSigningAudit::AuditError) { client.list('/v1/bundleIds') }
    assert_equal 'INVALID_PAGINATION', error.details[:code]
  end

  def test_cycle_in_pagination_is_bounded
    client = IosSigningAudit::Client.new('DUMMY_TOKEN')
    client.define_singleton_method(:read) do |uri|
      { 'data' => [], 'links' => { 'next' => uri.to_s } }
    end
    error = assert_raises(IosSigningAudit::AuditError) { client.list('/v1/bundleIds') }
    assert_equal 'INVALID_PAGINATION', error.details[:code]
  end

  def export_fixture
    p = profile
    p['id'] = IosSigningAudit::EXPORT_PROFILE_ID
    p['attributes']['name'] = IosSigningAudit::EXPORT_PROFILE_NAME
    p['attributes']['profileContent'] = Base64.strict_encode64('PUBLIC_CMS_FIXTURE')
    c = certificate
    c['id'] = IosSigningAudit::EXPORT_CERTIFICATE_ID
    d = decoded
    d['Name'] = IosSigningAudit::EXPORT_PROFILE_NAME
    [p, summary(p, c, d)]
  end

  def test_export_is_pinned_to_profile_name_id_certificate_and_verified_entitlements
    p, result = export_fixture
    Dir.mktmpdir do |parent|
      directory = File.join(parent, 'export')
      metadata = IosSigningAudit.export_profile(p, result, directory: directory)
      assert_equal 'PUBLIC_CMS_FIXTURE', File.binread(File.join(directory, 'main.mobileprovision'))
      assert_equal Digest::SHA256.hexdigest('PUBLIC_CMS_FIXTURE'), metadata[:sha256]
      assert_equal 0o600, File.stat(File.join(directory, 'main.mobileprovision')).mode & 0o777
      refute metadata[:containsPrivateKey]
    end
    [:id, 'name', :bundleId, :usableForRequestedAppStoreEntitlements, :certificates].each do |field|
      invalid = result.dup
      invalid[field] = field == :certificates ? [{ id: 'OTHER_CERTIFICATE' }] : 'WRONG_VALUE'
      error = assert_raises(IosSigningAudit::AuditError) { IosSigningAudit.export_profile(p, invalid) }
      assert_equal 'EXPORT_PROFILE_VERIFICATION_FAILED', error.details[:code]
    end
  end

  def test_failed_audit_never_exports_a_profile
    client = Object.new
    def client.list(_path, _query)
      raise IosSigningAudit::AuditError.new('APPLE_API_ERROR', path: '/v1/bundleIds', status: 403)
    end
    result = IosSigningAudit.audit(client, now: NOW, export_main_profile: true)
    refute result[:complete]
    refute result.key?(:exportedMainProfile)
  end
end
