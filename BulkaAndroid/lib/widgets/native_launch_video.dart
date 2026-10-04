part of '../main.dart';

/// Native startup must not wait for a video download or decoder. There is no
/// already initialized video at bootstrap, so keep the app visible immediately
/// rather than cover it later when an asynchronous media request finishes.
class NativeLaunchVideoGate extends StatelessWidget {
  const NativeLaunchVideoGate({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) => child;
}
