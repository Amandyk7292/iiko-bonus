require 'base64'
require 'digest'
require 'json'
require 'net/http'
require 'open3'
require 'openssl'
require 'time'
require 'uri'

# Read-only audit. Raw CMS profiles and certificate contents are never emitted.
module IosSigningAudit
  HOST = 'api.appstoreconnect.apple.com'.freeze
  BUNDLES = {
    'com.bulka.bonus' => {
      'com.apple.developer.devicecheck.appattest-environment' => 'production',
      'aps-environment' => 'production',
      'com.apple.developer.associated-domains' => ['applinks:bulka.com.kz'],
      'com.apple.security.application-groups' => ['group.com.bulka.bonus']
    },
    'com.bulka.bonus.BulkaWidget' => {
      'com.apple.security.application-groups' => ['group.com.bulka.bonus']
    }
  }.freeze
  PROFILE_FIELDS = %w[name platform profileType profileState uuid createdDate expirationDate].freeze
  CERTIFICATE_FIELDS = %w[name certificateType displayName serialNumber platform expirationDate activated].freeze
  EXPORT_PROFILE_ID = 'M4V6BMBK3M'.freeze
  EXPORT_PROFILE_NAME = 'Bulka App Store 20261004'.freeze
  EXPORT_CERTIFICATE_ID = '535X6SBK35'.freeze
  ENTITLEMENTS = (BUNDLES.values.flat_map(&:keys) +
    %w[application-identifier com.apple.developer.team-identifier get-task-allow]).uniq.freeze

  class AuditError < StandardError
    attr_reader :details

    def initialize(code, path: nil, status: nil)
      @details = { code: code }
      @details[:path] = path if path
      @details[:status] = status if status
      super(code)
    end
  end

  def self.token(env = ENV, now = Time.now)
    text = env.fetch('ASC_PRIVATE_KEY').strip
    text = Base64.strict_decode64(text) unless text.include?('BEGIN PRIVATE KEY')
    key = OpenSSL::PKey.read(text.gsub('\\n', "\n"))
    encoded = ->(value) { Base64.urlsafe_encode64(value, padding: false) }
    header = encoded.call(JSON.generate(alg: 'ES256', kid: env.fetch('ASC_KEY_ID'), typ: 'JWT'))
    claims = encoded.call(JSON.generate(iss: env.fetch('ASC_ISSUER_ID'), iat: now.to_i,
                                       exp: now.to_i + 600, aud: 'appstoreconnect-v1'))
    message = "#{header}.#{claims}"
    parts = OpenSSL::ASN1.decode(key.sign(OpenSSL::Digest::SHA256.new, message)).value
    raw = parts.map { |part| [part.value.to_i.to_s(16).rjust(64, '0')].pack('H*') }.join
    raise AuditError.new('INVALID_SIGNING_KEY') unless raw.bytesize == 64

    "#{message}.#{encoded.call(raw)}"
  end

  class Client
    def initialize(token)
      @token = token
      @requests = 0
    end

    def list(path, query = {})
      uri = URI("https://#{HOST}#{path}")
      uri.query = URI.encode_www_form(query.merge('limit' => '200'))
      result = []
      visited = {}
      20.times do
        raise AuditError.new('INVALID_PAGINATION', path: path) unless
          uri.scheme == 'https' && uri.host == HOST && uri.port == 443 &&
          uri.path == path && uri.userinfo.nil? && !visited[uri.to_s]

        visited[uri.to_s] = true
        page = read(uri)
        result.concat(page.fetch('data'))
        following = page.dig('links', 'next')
        return result if following.nil? || following.empty?

        uri = URI.join(uri.to_s, following)
      end
      raise AuditError.new('PAGINATION_LIMIT', path: path)
    end

    def get(path, query = {})
      uri = URI("https://#{HOST}#{path}")
      uri.query = URI.encode_www_form(query) unless query.empty?
      read(uri)
    end

    private

    def read(uri)
      @requests += 1
      raise AuditError.new('REQUEST_LIMIT', path: uri.path) if @requests > 200

      request = Net::HTTP::Get.new(uri)
      request['Authorization'] = "Bearer #{@token}"
      request['Accept'] = 'application/json'
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 10,
                                 read_timeout: 30) { |http| http.request(request) }
      raise AuditError.new('APPLE_API_ERROR', path: uri.path, status: response.code.to_i) unless
        response.is_a?(Net::HTTPSuccess)

      JSON.parse(response.body)
    end
  end

  def self.decode_profile(content)
    cms = Base64.strict_decode64(content)
    plist, _error, status = Open3.capture3('security', 'cms', '-D', stdin_data: cms, binmode: true)
    raise AuditError.new('PROFILE_CMS_DECODE_FAILED') unless status.success?

    # Full profiles contain dates and certificate bytes that JSON cannot encode.
    # Parse the plist and emit only the fields consumed by this audit.
    parser = <<~PYTHON
      import json, plistlib, sys
      profile = plistlib.loads(sys.stdin.buffer.read())
      fields = ('Entitlements', 'Name', 'UUID', 'TeamIdentifier', 'ApplicationIdentifierPrefix', 'ProvisionsAllDevices')
      result = {key: profile[key] for key in fields if key in profile}
      result['ProvisionedDevicesPresent'] = 'ProvisionedDevices' in profile
      result['ProvisionedDeviceCount'] = len(profile.get('ProvisionedDevices', []))
      print(json.dumps(result))
    PYTHON
    json, _error, status = Open3.capture3('python3', '-c', parser, stdin_data: plist)
    raise AuditError.new('PROFILE_PLIST_DECODE_FAILED') unless status.success?

    JSON.parse(json)
  end

  def self.expired(value, now)
    value.nil? ? nil : Time.iso8601(value) <= now
  end

  def self.entitlement_checks(actual, required)
    required.to_h do |name, expected|
      value = actual[name]
      matches = if expected.is_a?(Array)
                  value.is_a?(Array) && expected.all? { |entry| value.include?(entry) || value.include?('*') }
                else
                  value == expected
                end
      [name, matches]
    end
  end

  def self.profile_summary(profile, certificates, decoded, bundle, required, now)
    attributes = profile.fetch('attributes')
    entitlements = decoded.fetch('Entitlements', {})
    checks = entitlement_checks(entitlements, required)
    identifier = entitlements['application-identifier']
    prefix = decoded.fetch('ApplicationIdentifierPrefix', [])
    bundle_matches = prefix.any? { |entry| identifier == "#{entry}.#{bundle}" }
    is_store = attributes['profileType'] == 'IOS_APP_STORE'
    uuid_matches = decoded['UUID'] == attributes['uuid']
    name_matches = decoded['Name'] == attributes['name']
    team_matches = decoded.fetch('TeamIdentifier', []).include?(entitlements['com.apple.developer.team-identifier'])
    certs = certificates.map do |certificate|
      data = certificate.fetch('attributes').slice(*CERTIFICATE_FIELDS)
      { id: certificate.fetch('id'), **data, expired: expired(data['expirationDate'], now) }
    end
    valid = attributes['profileState'] == 'ACTIVE' && expired(attributes['expirationDate'], now) == false &&
      uuid_matches && name_matches && team_matches && bundle_matches && checks.values.all? && entitlements['get-task-allow'] != true &&
      !decoded['ProvisionedDevicesPresent'] && decoded['ProvisionsAllDevices'] != true &&
      !certs.empty? && certs.all? do |certificate|
        certificate[:expired] == false && certificate['activated'] != false &&
          %w[IOS_DISTRIBUTION DISTRIBUTION].include?(certificate['certificateType'])
      end
    {
      id: profile.fetch('id'), **attributes.slice(*PROFILE_FIELDS),
      bundleId: bundle, expired: expired(attributes['expirationDate'], now),
      decodedUuidMatches: uuid_matches, decodedName: decoded['Name'], decodedNameMatches: name_matches,
      teamIdentifierMatches: team_matches,
      teamIdentifiers: decoded.fetch('TeamIdentifier', []), applicationIdentifierPrefixes: prefix,
      entitlementValues: entitlements.slice(*ENTITLEMENTS), requiredEntitlements: checks,
      bundleIdentifierMatches: bundle_matches,
      provisionedDeviceCount: decoded.fetch('ProvisionedDeviceCount', 0),
      provisionsAllDevices: decoded['ProvisionsAllDevices'] == true,
      certificates: certs,
      usableForRequestedAppStoreEntitlements: is_store && valid
    }
  end

  def self.export_profile(profile, summary, directory: 'signing-audit')
    expected_certificates = summary.fetch(:certificates).map { |certificate| certificate.fetch(:id) }
    valid = profile.fetch('id') == EXPORT_PROFILE_ID && summary[:id] == EXPORT_PROFILE_ID &&
      summary['name'] == EXPORT_PROFILE_NAME && summary['profileState'] == 'ACTIVE' &&
      summary[:bundleId] == 'com.bulka.bonus' && summary[:usableForRequestedAppStoreEntitlements] == true &&
      expected_certificates == [EXPORT_CERTIFICATE_ID]
    raise AuditError.new('EXPORT_PROFILE_VERIFICATION_FAILED') unless valid

    content = Base64.strict_decode64(profile.fetch('attributes').fetch('profileContent'))
    Dir.mkdir(directory, 0o700)
    path = File.join(directory, 'main.mobileprovision')
    File.open(path, File::WRONLY | File::CREAT | File::EXCL, 0o600) { |file| file.binmode.write(content) }
    { id: EXPORT_PROFILE_ID, name: EXPORT_PROFILE_NAME, certificateId: EXPORT_CERTIFICATE_ID,
      uuid: summary['uuid'], sha256: Digest::SHA256.hexdigest(content), bytes: content.bytesize,
      path: 'signing-audit/main.mobileprovision', containsPrivateKey: false }
  end

  def self.audit(client, now: Time.now.utc, decoder: method(:decode_profile), export_main_profile: false)
    report = { schemaVersion: 1, readOnly: true, complete: false, auditedAt: now.iso8601,
               sourceCommit: ENV['GITHUB_SHA'], runId: ENV['GITHUB_RUN_ID'], bundles: [], errors: [] }
    begin
      export_candidate = nil
      BUNDLES.each do |identifier, required|
        matches = client.list('/v1/bundleIds', 'filter[identifier]' => identifier,
                              'fields[bundleIds]' => 'name,platform,identifier,seedId')
        matches.select! { |entry| entry.dig('attributes', 'identifier') == identifier }
        raise AuditError.new('BUNDLE_NOT_UNIQUE', path: '/v1/bundleIds') unless matches.length == 1

        bundle = matches.first
        id = bundle.fetch('id')
        raise AuditError.new('INVALID_RESOURCE_ID') unless id.match?(/\A[A-Za-z0-9-]+\z/)

        summary = { id: id, **bundle.fetch('attributes').slice('name', 'platform', 'identifier', 'seedId'),
                    requiredEntitlements: required, capabilities: [], profiles: [] }
        report[:bundles] << summary
        capabilities = client.list("/v1/bundleIds/#{id}/bundleIdCapabilities",
                                   'fields[bundleIdCapabilities]' => 'capabilityType')
        summary[:capabilities] = capabilities.map do |capability|
          { id: capability.fetch('id'), capabilityType: capability.dig('attributes', 'capabilityType') }
        end
        profiles = client.list("/v1/bundleIds/#{id}/profiles",
                               'fields[profiles]' => (PROFILE_FIELDS + ['profileContent']).join(','))
        profiles.each do |profile|
          profile_id = profile.fetch('id')
          raise AuditError.new('INVALID_RESOURCE_ID') unless profile_id.match?(/\A[A-Za-z0-9-]+\z/)

          certificates = client.list("/v1/profiles/#{profile_id}/certificates",
                                     'fields[certificates]' => CERTIFICATE_FIELDS.join(','))
          decoded = decoder.call(profile.fetch('attributes').fetch('profileContent'))
          profile_result = profile_summary(profile, certificates, decoded, identifier, required, now)
          summary[:profiles] << profile_result
          if identifier == 'com.bulka.bonus' && profile_id == EXPORT_PROFILE_ID
            export_candidate = [profile, profile_result]
          end
        end
      end
      if export_main_profile
        raise AuditError.new('EXPORT_PROFILE_NOT_FOUND') unless export_candidate

        # Re-read the exact profile after the audit, including its current bundle
        # relationship, so a portal regeneration cannot export an older snapshot.
        response = client.get("/v1/profiles/#{EXPORT_PROFILE_ID}",
                              'fields[profiles]' => (PROFILE_FIELDS + %w[profileContent bundleId]).join(','),
                              'include' => 'bundleId', 'fields[bundleIds]' => 'identifier')
        latest = response.fetch('data')
        bundle_id = latest.dig('relationships', 'bundleId', 'data', 'id')
        bundle = response.fetch('included', []).find { |entry| entry['type'] == 'bundleIds' && entry['id'] == bundle_id }
        raise AuditError.new('EXPORT_BUNDLE_RELATIONSHIP_MISMATCH') unless
          bundle && bundle.dig('attributes', 'identifier') == 'com.bulka.bonus'

        certificates = client.list("/v1/profiles/#{EXPORT_PROFILE_ID}/certificates",
                                   'fields[certificates]' => CERTIFICATE_FIELDS.join(','))
        result = profile_summary(latest, certificates, decoder.call(latest.fetch('attributes').fetch('profileContent')),
                                 'com.bulka.bonus', BUNDLES.fetch('com.bulka.bonus'), now)
        report[:exportedMainProfile] = export_profile(latest, result)
      end
      report[:complete] = true
    rescue AuditError => error
      report[:errors] << error.details
    rescue StandardError
      # Neither server payloads nor parser/key exception messages belong in logs.
      report[:errors] << { code: 'AUDIT_FAILED' }
    end
    report
  end
end

if $PROGRAM_NAME == __FILE__
  begin
    client = IosSigningAudit::Client.new(IosSigningAudit.token)
    report = IosSigningAudit.audit(client, export_main_profile: ENV['EXPORT_MAIN_PROFILE'] == 'true')
  rescue StandardError
    report = { schemaVersion: 1, readOnly: true, complete: false, bundles: [],
               errors: [{ code: 'AUTHENTICATION_SETUP_FAILED' }] }
  end
  puts JSON.pretty_generate(report)
  exit(report[:complete] ? 0 : 1)
end
