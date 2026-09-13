import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../core/theme.dart';
import '../../services/api_client.dart';
import 'link_device_confirm_screen.dart';

/// Paramètres → Appareils connectés → "Connecter un appareil" (section 7).
/// Extrait le jeton de `glotta://link-device?request=<token>` (ou accepte la
/// valeur brute telle quelle si le QR ne contient que le jeton — tolérance
/// utile en test manuel), l'envoie au backend pour validation (existe/pas
/// expiré/pas déjà utilisé), puis enchaîne sur l'écran de confirmation.
class QrScannerScreen extends StatefulWidget {
  const QrScannerScreen({super.key});

  @override
  State<QrScannerScreen> createState() => _QrScannerScreenState();
}

class _QrScannerScreenState extends State<QrScannerScreen> {
  final _controller = MobileScannerController();
  bool _handling = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  String? _extractToken(String raw) {
    final uri = Uri.tryParse(raw);
    if (uri != null && uri.queryParameters['request'] != null) {
      return uri.queryParameters['request'];
    }
    return raw.isNotEmpty ? raw : null;
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_handling) return;
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw == null) return;
    final token = _extractToken(raw);
    if (token == null) return;

    setState(() {
      _handling = true;
      _error = null;
    });
    await _controller.stop();
    try {
      final info = await ApiClient.instance.scanLinkRequest(token);
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => LinkDeviceConfirmScreen(token: token, info: info)),
      );
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
      await _controller.start();
    } finally {
      if (mounted) setState(() => _handling = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        iconTheme: const IconThemeData(color: Colors.white),
        title: const Text('Scanner le QR', style: TextStyle(color: Colors.white)),
      ),
      extendBodyBehindAppBar: true,
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(controller: _controller, onDetect: _onDetect),
          Center(
            child: Container(
              width: 250,
              height: 250,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white70, width: 2),
                borderRadius: BorderRadius.circular(16),
              ),
            ),
          ),
          Positioned(
            left: 24,
            right: 24,
            bottom: 40,
            child: Column(
              children: [
                const Text(
                  'Ouvrez Glotta Web sur votre ordinateur et scannez le QR affiché.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white70),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: c.danger)),
                ],
                if (_handling) ...[
                  const SizedBox(height: 10),
                  const CircularProgressIndicator(color: Colors.white),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
