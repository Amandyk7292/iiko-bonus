part of '../main.dart';

class AddressDetailsScreen extends StatefulWidget {
  const AddressDetailsScreen({required this.location, super.key});

  final DeliveryLocation location;

  @override
  State<AddressDetailsScreen> createState() => _AddressDetailsScreenState();
}

class _AddressDetailsScreenState extends State<AddressDetailsScreen> {
  final _formKey = GlobalKey<FormState>();
  final _titleController = TextEditingController();
  final _houseController = TextEditingController();
  final _floorController = TextEditingController();
  final _apartmentController = TextEditingController();
  final _commentController = TextEditingController();

  @override
  void dispose() {
    _titleController.dispose();
    _houseController.dispose();
    _floorController.dispose();
    _apartmentController.dispose();
    _commentController.dispose();
    super.dispose();
  }

  void _save() {
    if (!_formKey.currentState!.validate()) return;
    final address = DeliveryAddress(
      id: DateTime.now().microsecondsSinceEpoch.toString(),
      title: _titleController.text.trim(),
      location: widget.location,
      house: _houseController.text.trim(),
      floor: _emptyToNull(_floorController.text),
      apartment: _emptyToNull(_apartmentController.text),
      courierComment: _emptyToNull(_commentController.text),
    );
    Navigator.of(context).pop(address);
  }

  String? _required(String? value) {
    if ((value ?? '').trim().isEmpty) return 'Заполните поле';
    return null;
  }

  String? _emptyToNull(String value) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        centerTitle: true,
        backgroundColor: Colors.white,
        leading: IconButton(
          onPressed: () => Navigator.of(context).pop(),
          icon: const Icon(Icons.chevron_left_rounded, size: 34),
          color: _cocoa.withValues(alpha: 0.56),
          tooltip: 'Назад',
        ),
        title: Text(
          widget.location.address,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontFamily: _headingFont,
            fontSize: 28,
            fontWeight: FontWeight.w400,
          ),
        ),
      ),
      body: SafeArea(
        top: false,
        child: Form(
          key: _formKey,
          child: ListView(
            padding: EdgeInsets.zero,
            children: [
              SizedBox(
                height: 330,
                width: double.infinity,
                child: _DeliveryMap(
                  controller: null,
                  point: LatLng(
                    widget.location.latitude,
                    widget.location.longitude,
                  ),
                  interactive: false,
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(32, 34, 32, 28),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _BulkaTextField(
                      label: 'Название адреса',
                      controller: _titleController,
                      validator: _required,
                    ),
                    const SizedBox(height: 18),
                    Row(
                      children: [
                        Expanded(
                          child: _BulkaTextField(
                            label: 'Дом',
                            controller: _houseController,
                            validator: _required,
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: _BulkaTextField(
                            label: 'Этаж',
                            controller: _floorController,
                            keyboardType: TextInputType.number,
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: _BulkaTextField(
                            label: 'Квартира',
                            controller: _apartmentController,
                            keyboardType: TextInputType.text,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),
                    _BulkaTextField(
                      label: 'Комментарий для курьера',
                      controller: _commentController,
                      minLines: 2,
                      maxLines: 3,
                    ),
                    const SizedBox(height: 28),
                    const Divider(height: 1),
                    const SizedBox(height: 28),
                    SizedBox(
                      width: double.infinity,
                      height: 72,
                      child: GradientButton(
                        onPressed: _save,
                        height: 72,
                        child: const Text(
                          'Продолжить',
                          style: TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w400,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BulkaTextField extends StatelessWidget {
  const _BulkaTextField({
    required this.label,
    required this.controller,
    this.validator,
    this.keyboardType,
    this.minLines = 1,
    this.maxLines = 1,
  });

  final String label;
  final TextEditingController controller;
  final FormFieldValidator<String>? validator;
  final TextInputType? keyboardType;
  final int minLines;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: Colors.black,
            fontFamily: _headingFont,
            fontSize: 20,
            fontWeight: FontWeight.w400,
          ),
        ),
        const SizedBox(height: 8),
        TextFormField(
          controller: controller,
          validator: validator,
          keyboardType: keyboardType,
          minLines: minLines,
          maxLines: maxLines,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
          decoration: InputDecoration(
            hintText: 'Введите',
            hintStyle: TextStyle(
              color: _textDark.withValues(alpha: 0.36),
              fontSize: 18,
              fontWeight: FontWeight.w600,
            ),
            filled: true,
            fillColor: Colors.white,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 22,
              vertical: 22,
            ),
            errorMaxLines: 2,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide(color: _textDark.withValues(alpha: 0.1)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide(color: _textDark.withValues(alpha: 0.1)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: _almond, width: 1.6),
            ),
            errorBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: _errorRed),
            ),
            focusedErrorBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: _errorRed, width: 1.4),
            ),
          ),
        ),
      ],
    );
  }
}
