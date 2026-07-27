import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Supabase public images use a bounded render URL', () {
    final result = optimizedNetworkImageUrl(
      'https://project.supabase.co/storage/v1/object/public/menu_images/bun.webp',
      pixelWidth: 700,
      pixelHeight: 900,
    );
    final uri = Uri.parse(result);

    expect(uri.path, '/storage/v1/render/image/public/menu_images/bun.webp');
    expect(uri.queryParameters, {
      'width': '700',
      'height': '900',
      'resize': 'contain',
      'quality': '80',
    });
  });

  test('image resize dimensions are capped for mobile browser safety', () {
    final uri = Uri.parse(
      optimizedNetworkImageUrl(
        'https://project.supabase.co/storage/v1/object/public/menu_images/bun.webp',
        pixelWidth: 4000,
        pixelHeight: 3000,
      ),
    );

    expect(uri.queryParameters['width'], '1536');
    expect(uri.queryParameters['height'], '1536');
  });

  test('cover images request a cropped CDN rendition', () {
    final uri = Uri.parse(
      optimizedNetworkImageUrl(
        'https://project.supabase.co/storage/v1/object/public/menu_images/bun.webp',
        pixelWidth: 512,
        pixelHeight: 512,
        resizeMode: 'cover',
      ),
    );

    expect(uri.queryParameters['resize'], 'cover');
  });

  test('unsupported resize modes fall back to contain', () {
    final uri = Uri.parse(
      optimizedNetworkImageUrl(
        'https://project.supabase.co/storage/v1/object/public/menu_images/bun.webp',
        pixelWidth: 512,
        pixelHeight: 512,
        resizeMode: 'stretch',
      ),
    );

    expect(uri.queryParameters['resize'], 'contain');
  });

  test('existing URL encoding and query values are preserved', () {
    final result = optimizedNetworkImageUrl(
      'https://project.supabase.co/storage/v1/object/public/menu_images/'
      'sweet%20bun.webp?token=a%2Bb',
      pixelWidth: 512,
      pixelHeight: 512,
    );
    final uri = Uri.parse(result);

    expect(result, contains('sweet%20bun.webp'));
    expect(result, isNot(contains('sweet%2520bun.webp')));
    expect(uri.queryParameters['token'], 'a+b');
  });

  test('non-Supabase image URLs remain unchanged', () {
    const source = 'https://cdn.example.com/images/bun.webp';

    expect(
      optimizedNetworkImageUrl(source, pixelWidth: 512, pixelHeight: 512),
      source,
    );
  });

  test('web image density is capped to avoid oversized mobile downloads', () {
    expect(networkImageDevicePixelRatio(3, isWeb: true), 2.25);
    expect(networkImageDevicePixelRatio(2, isWeb: true), 2);
  });

  test('native image density keeps the larger cache allowance', () {
    expect(networkImageDevicePixelRatio(4, isWeb: false), 3);
    expect(networkImageDevicePixelRatio(double.nan, isWeb: false), 1);
  });
}
