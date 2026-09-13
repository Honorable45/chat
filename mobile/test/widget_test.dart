import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glotta_mobile/core/theme.dart';
import 'package:glotta_mobile/screens/splash_screen.dart';

void main() {
  testWidgets('Le splash screen affiche le logo "Glotta"', (WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(theme: glottaDarkTheme, home: const SplashScreen()),
      ),
    );
    expect(find.text('Glotta'), findsOneWidget);
  });
}
