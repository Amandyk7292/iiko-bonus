require 'minitest/autorun'
require 'minitest/mock'
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

  def test_actual_provider_permission_arrays_and_scalar_domains_allow_production_profile
    p, _result = export_fixture
    c = certificate
    c['id'] = IosSigningAudit::EXPORT_CERTIFICATE_ID
    d = decoded
    d['Name'] = IosSigningAudit::EXPORT_PROFILE_NAME
    d['Entitlements']['com.apple.developer.devicecheck.appattest-environment'] = %w[development production]
    d['Entitlements']['com.apple.developer.associated-domains'] = '*'
    result = summary(p, c, d)
    assert result[:requiredEntitlements].values.all?
    assert result[:usableForRequestedAppStoreEntitlements]
    Dir.mktmpdir do |parent|
      IosSigningAudit.export_profile(p, result, directory: File.join(parent, 'export'))
      assert_equal 'PUBLIC_CMS_FIXTURE', File.binread(File.join(parent, 'export', 'main.mobileprovision'))
    end
  end

  def test_permission_compatibility_does_not_allow_development_only_or_wildcard_app_attest
    ['development', ['development'], '*', ['*'], nil].each do |permission|
      d = decoded
      d['Entitlements']['com.apple.developer.devicecheck.appattest-environment'] = permission
      d['Entitlements']['com.apple.developer.associated-domains'] = '*'
      result = summary(profile, certificate, d)
      refute result[:requiredEntitlements]['com.apple.developer.devicecheck.appattest-environment']
      refute result[:usableForRequestedAppStoreEntitlements]
    end
    d = decoded
    d['Entitlements']['com.apple.security.application-groups'] = '*'
    refute summary(profile, certificate, d)[:usableForRequestedAppStoreEntitlements]
    d = decoded
    d['Entitlements']['com.apple.developer.team-identifier'] = '*'
    refute summary(profile, certificate, d)[:usableForRequestedAppStoreEntitlements]
    d = decoded
    d['Entitlements']['get-task-allow'] = true
    refute summary(profile, certificate, d)[:usableForRequestedAppStoreEntitlements]
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

  def test_apple_api_error_preserves_only_bounded_diagnostic_fields
    body = JSON.generate(errors: [{ code: 'PARAMETER_ERROR.INVALID', title: 'Invalid parameter',
                                   detail: "limit must be less than 50\n", id: 'UNEXPECTED_ID',
                                   response: 'RAW_PROFILE_MUST_NOT_LEAK' }] * 8)
    errors = IosSigningAudit.apple_errors(body)
    assert_equal 5, errors.length
    assert_equal({ 'code' => 'PARAMETER_ERROR.INVALID', 'title' => 'Invalid parameter',
                   'detail' => 'limit must be less than 50 ' }, errors.first)
    error = IosSigningAudit::AuditError.new('APPLE_API_ERROR', path: '/v1/bundleIds/id/bundleIdCapabilities',
                                           status: 400, apple_errors: errors)
    assert_equal errors, error.details[:appleErrors]
    refute_match(/RAW_PROFILE|UNEXPECTED_ID/, JSON.generate(error.details))
    assert_equal 500, IosSigningAudit.apple_errors(JSON.generate(errors: [{ detail: 'word ' * 200 }])).first['detail'].length
  end

  def test_apple_api_error_redacts_credentials_and_ignores_raw_non_json_payloads
    key = "-----BEGIN PRIVATE KEY-----\nPRIVATE_KEY_BYTES\n-----END PRIVATE KEY-----"
    jwt = 'eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJpc3N1ZXIifQ.c2lnbmF0dXJl'
    body = JSON.generate(errors: [{ code: 'NOT_AUTHORIZED',
                                   detail: "Bearer #{jwt}; #{key}; secret-value; #{'A' * 160}" }])
    errors = IosSigningAudit.apple_errors(body, redactions: ['secret-value'])
    text = JSON.generate(errors)
    refute_match(/PRIVATE_KEY_BYTES|secret-value|eyJhbGci|#{'A' * 100}/, text)
    assert_match(/REDACTED/, text)
    assert_empty IosSigningAudit.apple_errors("<html>#{key}</html>")
    assert_empty IosSigningAudit.apple_errors(JSON.generate(errors: 'unexpected'))
    assert_empty IosSigningAudit.apple_errors('A' * 65_537)
  end

  def test_invalid_pagination_cannot_forward_bearer_to_another_host
    client = IosSigningAudit::Client.new('DUMMY_TOKEN')
    client.define_singleton_method(:read) do |_uri|
      { 'data' => [], 'links' => { 'next' => 'https://other.example/v1/bundleIds' } }
    end
    error = assert_raises(IosSigningAudit::AuditError) { client.list('/v1/bundleIds') }
    assert_equal 'INVALID_PAGINATION', error.details[:code]
  end

  def test_relationship_outgoing_get_does_not_force_unsupported_limit
    requests = []
    response = Net::HTTPOK.new('1.1', '200', 'OK')
    body = JSON.generate(data: [], links: { next: nil })
    response.define_singleton_method(:body) { body }
    http = Object.new
    http.define_singleton_method(:request) do |request|
      requests << request
      response
    end
    transport = ->(*_args, &block) { block.call(http) }
    Net::HTTP.stub(:start, transport) do
      result = IosSigningAudit::Client.new('DUMMY_TOKEN').list('/v1/bundleIds/id/bundleIdCapabilities',
        'fields[bundleIdCapabilities]' => 'capabilityType')
      assert_empty result
    end
    assert_equal 1, requests.length
    assert_equal 'GET', requests.first.method
    query = URI.decode_www_form(URI(requests.first.path).query).to_h
    assert_equal({ 'fields[bundleIdCapabilities]' => 'capabilityType' }, query)
    refute query.key?('limit')
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

  def complete_audit_fixture(failing_profile: 'stale-id', status: 404, code: 'NOT_FOUND')
    main, _result = export_fixture
    stale = profile
    stale['id'] = 'stale-id'
    stale['attributes']['profileContent'] = 'STALE_PROFILE_MUST_NOT_DECODE'
    widget = profile
    widget['id'] = 'widget-profile'
    widget['attributes']['name'] = 'WidgetStore'
    widget['attributes']['profileContent'] = 'WIDGET_CMS_FIXTURE'
    cert = certificate
    cert['id'] = IosSigningAudit::EXPORT_CERTIFICATE_ID
    client = Object.new
    client.define_singleton_method(:list) do |path, query|
      if path == '/v1/bundleIds'
        identifier = query.fetch('filter[identifier]')
        id = identifier == 'com.bulka.bonus' ? 'main-bundle' : 'widget-bundle'
        [{ 'id' => id, 'attributes' => { 'identifier' => identifier } }]
      elsif path.end_with?('/bundleIdCapabilities')
        []
      elsif path == '/v1/bundleIds/main-bundle/profiles'
        [stale, main]
      elsif path == '/v1/bundleIds/widget-bundle/profiles'
        [widget]
      elsif path == "/v1/profiles/#{failing_profile}/certificates"
        raise IosSigningAudit::AuditError.new('APPLE_API_ERROR', path: path, status: status,
          apple_errors: [{ 'code' => code, 'detail' => 'Profile is unavailable' }])
      elsif path == '/v1/profiles/stale-id/certificates'
        raise IosSigningAudit::AuditError.new('APPLE_API_ERROR', path: path, status: 404,
          apple_errors: [{ 'code' => 'NOT_FOUND', 'detail' => 'Profile is unavailable' }])
      elsif path.end_with?('/certificates')
        [cert]
      else
        raise 'Unexpected fixture request'
      end
    end
    client.define_singleton_method(:get) do |path, _query|
      raise 'Unexpected fixture profile lookup' unless path == "/v1/profiles/#{IosSigningAudit::EXPORT_PROFILE_ID}"

      { 'data' => main.merge('relationships' => { 'bundleId' => { 'data' => { 'id' => 'main-bundle' } } }),
        'included' => [{ 'type' => 'bundleIds', 'id' => 'main-bundle',
                         'attributes' => { 'identifier' => 'com.bulka.bonus' } }] }
    end
    decoder = lambda do |content|
      value = decoded
      if content == widget['attributes']['profileContent']
        value['Name'] = 'WidgetStore'
        value['Entitlements']['application-identifier'] = 'LEGACY.com.bulka.bonus.BulkaWidget'
      elsif content == main['attributes']['profileContent']
        value['Name'] = IosSigningAudit::EXPORT_PROFILE_NAME
      else
        raise 'Stale profile must not be decoded'
      end
      value
    end
    [client, decoder]
  end

  def test_unrelated_stale_not_found_profile_does_not_prevent_verified_target_export
    client, decoder = complete_audit_fixture
    Dir.mktmpdir do |directory|
      Dir.chdir(directory) do
        result = IosSigningAudit.audit(client, now: NOW, decoder: decoder, export_main_profile: true)
        assert result[:complete], result[:errors].inspect
        assert_empty result[:errors]
        stale = result[:bundles].first[:profiles].find { |entry| entry[:id] == 'stale-id' }
        assert stale[:unavailable]
        refute stale[:usableForRequestedAppStoreEntitlements]
        assert_equal 'NOT_FOUND', stale[:unavailableReason][:appleErrors].first['code']
        refute_match(/STALE_PROFILE_MUST_NOT_DECODE|profileContent/, JSON.generate(result))
        assert_equal IosSigningAudit::EXPORT_PROFILE_ID, result[:exportedMainProfile][:id]
        assert_equal 'PUBLIC_CMS_FIXTURE', File.binread('signing-audit/main.mobileprovision')
      end
    end
  end

  def test_target_not_found_and_other_unrelated_errors_remain_blocking
    failures = [
      { failing_profile: IosSigningAudit::EXPORT_PROFILE_ID, status: 404, code: 'NOT_FOUND' },
      { status: 403, code: 'NOT_FOUND' },
      { status: 500, code: 'NOT_FOUND' },
      { status: 404, code: 'OTHER_ERROR' }
    ]
    failures.each do |options|
      client, decoder = complete_audit_fixture(**options)
      Dir.mktmpdir do |directory|
        Dir.chdir(directory) do
          result = IosSigningAudit.audit(client, now: NOW, decoder: decoder, export_main_profile: true)
          refute result[:complete]
          refute result.key?(:exportedMainProfile)
          refute File.exist?('signing-audit/main.mobileprovision')
          assert_equal 'APPLE_API_ERROR', result[:errors].first[:code]
        end
      end
    end
  end
end
