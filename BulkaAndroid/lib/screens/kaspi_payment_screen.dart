import 'dart:async';
import 'package:flutter/material.dart';
import '../main.dart'; // import BulkaApiClient or dependencies

class KaspiPaymentScreen extends StatefulWidget {
  final String operationId;

  const KaspiPaymentScreen({
    Key? key,
    required this.operationId,
  }) : super(key: key);

  @override
  State<KaspiPaymentScreen> createState() => _KaspiPaymentScreenState();
}

class _KaspiPaymentScreenState extends State<KaspiPaymentScreen> {
  Timer? _pollingTimer;
  bool _isPaid = false;
  bool _isError = false;
  String _errorMessage = '';

  @override
  void initState() {
    super.initState();
    _startPolling();
  }

  void _startPolling() {
    // Poll every 3 seconds for payment status
    _pollingTimer = Timer.periodic(const Duration(seconds: 3), (timer) async {
      try {
        final result = await api.checkKaspiPaymentStatus(widget.operationId);
        
        if (result['status'] == 'paid') {
          timer.cancel();
          setState(() {
            _isPaid = true;
          });
          // Optionally auto-navigate back or to success screen:
          // Future.delayed(Duration(seconds: 2), () => Navigator.pop(context, true));
        } else if (result['status'] == 'failed' || result['status'] == 'expired') {
          timer.cancel();
          setState(() {
            _isError = true;
            _errorMessage = 'Счет отменен или истек по времени.';
          });
        }
      } catch (e) {
        // Ignore network errors during polling, keep trying
      }
    });
  }

  @override
  void dispose() {
    _pollingTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_isPaid) {
      return Scaffold(
        backgroundColor: Colors.white,
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: const [
              Icon(Icons.check_circle, color: Colors.green, size: 100),
              SizedBox(height: 24),
              Text(
                'Успешно оплачено!',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 12),
              Text('Ваш заказ передан на кухню.'),
            ],
          ),
        ),
      );
    }

    if (_isError) {
      return Scaffold(
        appBar: AppBar(title: const Text('Ошибка оплаты')),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.error, color: Colors.red, size: 80),
              const SizedBox(height: 24),
              Text(
                _errorMessage,
                style: const TextStyle(fontSize: 18),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Вернуться назад'),
              )
            ],
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Оплата через Kaspi'),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: const [
              CircularProgressIndicator(color: Colors.red),
              SizedBox(height: 32),
              Text(
                'Счет на оплату отправлен!',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
              SizedBox(height: 16),
              Text(
                'Пожалуйста, откройте приложение Kaspi.kz на вашем телефоне и подтвердите платеж.',
                style: TextStyle(fontSize: 16, color: Colors.grey),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
