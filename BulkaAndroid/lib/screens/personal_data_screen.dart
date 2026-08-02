part of '../main.dart';

class PersonalDataScreen extends StatefulWidget {
  const PersonalDataScreen({
    required this.api,
    required this.customer,
    required this.onBack,
    required this.onLogout,
    required this.onProfileUpdated,
    super.key,
  });

  final BulkaApiClient api;
  final Customer customer;
  final VoidCallback onBack;
  final Future<void> Function() onLogout;
  final Future<void> Function() onProfileUpdated;

  @override
  State<PersonalDataScreen> createState() => _PersonalDataScreenState();
}

class _PersonalDataScreenState extends State<PersonalDataScreen> {
  late TextEditingController _nameController;
  late TextEditingController _lastNameController;
  late TextEditingController _birthDateController;
  late TextEditingController _emailController;

  String? _selectedGender;
  String? _selectedCity;
  String? _birthDate;
  bool _isLoading = false;
  bool _citiesLoading = true;
  bool _citiesFailed = false;
  List<City> _cities = [];

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(
      text: isGuestName(widget.customer.name) ? '' : widget.customer.name,
    );
    _lastNameController = TextEditingController(
      text: widget.customer.lastName ?? '',
    );
    _selectedCity = widget.customer.region;
    _emailController = TextEditingController(text: widget.customer.email ?? '');

    _selectedGender = widget.customer.gender;
    _birthDate = widget.customer.birthDate;

    // Convert stored date (YYYY-MM-DD) to display format (DD.MM.YYYY)
    _birthDateController = TextEditingController(
      text: _formatDateForDisplay(_birthDate),
    );

    _loadCities();
  }

  Future<void> _loadCities() async {
    if (mounted) {
      setState(() {
        _citiesLoading = true;
        _citiesFailed = false;
      });
    }
    try {
      final cities = await widget.api.getCities();
      if (mounted) {
        setState(() {
          _cities = cities;
          _citiesLoading = false;
          // Validate selected city
          if (_selectedCity != null &&
              _selectedCity!.isNotEmpty &&
              !_cities.any((c) => c.name == _selectedCity)) {
            // Keep it if it's custom, or we can clear it. Better to keep it so data is not lost.
          }
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _citiesLoading = false;
          _citiesFailed = true;
        });
      }
      debugPrint('Failed to load cities: $e');
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _lastNameController.dispose();
    _birthDateController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  void _showInfoMessage(String message, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? Colors.red.shade800 : Colors.green.shade800,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BulkaRadii.control),
        ),
      ),
    );
  }

  Future<void> _saveProfile() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      _showInfoMessage('reg_err_name'.tr, isError: true);
      return;
    }
    final dateInput = _birthDateController.text.trim();
    if (dateInput.isNotEmpty && _parseDateForApi(dateInput) == null) {
      _showInfoMessage('invalid_date'.tr, isError: true);
      return;
    }
    final email = _emailController.text.trim();
    if (email.isNotEmpty &&
        !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) {
      _showInfoMessage('invalid_email'.tr, isError: true);
      return;
    }
    setState(() => _isLoading = true);
    try {
      await widget.api.updateProfile(
        phone: widget.customer.phone,
        name: name,
        lastName: _lastNameController.text.trim(),
        gender: _selectedGender,
        birthDate: _birthDate,
        email: email.isEmpty ? null : email,
        region: _selectedCity ?? widget.customer.region ?? '',
      );

      await widget.onProfileUpdated();
      _showInfoMessage('profile_saved'.tr);
      widget.onBack();
    } catch (e) {
      _showInfoMessage(
        localizeErrorMessage(e, fallbackKey: 'error_save'),
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _deleteAccount() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          'delete_account_title'.tr,
          style: const TextStyle(fontFamily: _headingFont),
        ),
        content: Text('delete_account_message'.tr),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BulkaRadii.control),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(
              'cancel_btn'.tr,
              style: const TextStyle(color: Colors.grey),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(
              'delete_btn'.tr,
              style: const TextStyle(
                fontFamily: _headingFont,
                color: Colors.red,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );

    if (confirm == true) {
      setState(() => _isLoading = true);
      try {
        await widget.api.deleteAccount(widget.customer.phone);
        if (mounted) {
          Navigator.pop(context); // Close dialog or screen
          await widget.onLogout();
        }
      } catch (e) {
        _showInfoMessage(
          localizeErrorMessage(e, fallbackKey: 'error_delete_account'),
          isError: true,
        );
        if (mounted) setState(() => _isLoading = false);
      }
    }
  }

  // Convert YYYY-MM-DD to DD.MM.YYYY for display
  String _formatDateForDisplay(String? dateString) {
    if (dateString == null || dateString.isEmpty) return '';
    try {
      final parts = dateString.split('T')[0].split('-');
      if (parts.length == 3) {
        return '${parts[2]}.${parts[1]}.${parts[0]}';
      }
    } catch (_) {}
    return dateString;
  }

  // Convert DD.MM.YYYY to YYYY-MM-DD for API
  String? _parseDateForApi(String displayDate) {
    if (displayDate.isEmpty) return null;
    final parts = displayDate.split('.');
    if (parts.length == 3 &&
        parts[0].length == 2 &&
        parts[1].length == 2 &&
        parts[2].length == 4) {
      final day = int.tryParse(parts[0]);
      final month = int.tryParse(parts[1]);
      final year = int.tryParse(parts[2]);
      if (day == null || month == null || year == null) return null;
      final date = DateTime.tryParse('${parts[2]}-${parts[1]}-${parts[0]}');
      if (date == null ||
          date.day != day ||
          date.month != month ||
          date.year != year ||
          date.isAfter(DateTime.now())) {
        return null;
      }
      return '${parts[2]}-${parts[1]}-${parts[0]}';
    }
    return null;
  }

  // Auto-format date input: insert dots after DD and MM
  void _onBirthDateChanged(String value) {
    // Remove all non-digits
    String digits = value.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.length > 8) digits = digits.substring(0, 8);

    String formatted = '';
    for (int i = 0; i < digits.length; i++) {
      if (i == 2 || i == 4) formatted += '.';
      formatted += digits[i];
    }

    if (formatted != value) {
      _birthDateController.value = TextEditingValue(
        text: formatted,
        selection: TextSelection.collapsed(offset: formatted.length),
      );
    }

    // Update _birthDate if we have a complete date
    _birthDate = _parseDateForApi(formatted);
  }

  Widget _buildCityDropdown() {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'city_label'.tr,
            style: TextStyle(
              color: scheme.onSurface,
              fontSize: BulkaTypeScale.body,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(
              color: scheme.surface,
              borderRadius: BorderRadius.circular(BulkaRadii.control),
              border: Border.all(color: colors.cardBorder, width: 1.5),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF532814).withValues(alpha: 0.04),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                isExpanded: true,
                value: _selectedCity?.isNotEmpty == true ? _selectedCity : null,
                hint: Text(
                  'select_city'.tr,
                  style: const TextStyle(
                    color: Color(0x66231007),
                    fontSize: BulkaTypeScale.body,
                  ),
                ),
                icon: _citiesLoading
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(
                        Icons.keyboard_arrow_down_rounded,
                        color: Color(0xFF532814),
                      ),
                dropdownColor: scheme.surface,
                borderRadius: BorderRadius.circular(BulkaRadii.control),
                items: [
                  if (_selectedCity != null &&
                      _selectedCity!.isNotEmpty &&
                      !_cities.any((c) => c.name == _selectedCity))
                    DropdownMenuItem<String>(
                      value: _selectedCity,
                      child: Text(
                        _selectedCity!,
                        style: TextStyle(
                          color: scheme.onSurface,
                          fontSize: BulkaTypeScale.body,
                        ),
                      ),
                    ),
                  ..._cities.map((city) {
                    return DropdownMenuItem<String>(
                      value: city.name,
                      child: Text(
                        city.name,
                        style: TextStyle(
                          color: scheme.onSurface,
                          fontSize: BulkaTypeScale.body,
                        ),
                      ),
                    );
                  }),
                ],
                onChanged: _citiesLoading || _cities.isEmpty
                    ? null
                    : (value) {
                        setState(() {
                          _selectedCity = value;
                        });
                      },
              ),
            ),
          ),
          if (_citiesFailed) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'error_load_cities'.tr,
                    style: const TextStyle(
                      color: _errorRed,
                      fontSize: BulkaTypeScale.bodySmall,
                    ),
                  ),
                ),
                TextButton(onPressed: _loadCities, child: Text('retry_btn'.tr)),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildDateField() {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'birthdate_label'.tr,
          style: TextStyle(
            color: scheme.onSurface,
            fontSize: BulkaTypeScale.body,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _birthDateController,
          keyboardType: TextInputType.number,
          onChanged: _onBirthDateChanged,
          style: TextStyle(
            fontSize: BulkaTypeScale.body,
            color: scheme.onSurface,
          ),
          decoration: InputDecoration(
            hintText: 'date_hint'.tr,
            hintStyle: TextStyle(color: colors.mutedText),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 14,
            ),
          ),
        ),
        const SizedBox(height: 16),
      ],
    );
  }

  Widget _buildTextField(
    String label,
    TextEditingController controller, {
    bool readOnly = false,
    VoidCallback? onTap,
    Widget? badge,
    TextInputType? keyboardType,
  }) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label,
              style: TextStyle(
                color: scheme.onSurface,
                fontSize: BulkaTypeScale.body,
                fontWeight: FontWeight.w600,
              ),
            ),
            ?badge,
          ],
        ),
        const SizedBox(height: 8),
        TextField(
          controller: controller,
          readOnly: readOnly,
          onTap: onTap,
          keyboardType: keyboardType,
          autofillHints: keyboardType == TextInputType.emailAddress
              ? const [AutofillHints.email]
              : null,
          autocorrect: keyboardType != TextInputType.emailAddress,
          style: TextStyle(
            fontSize: BulkaTypeScale.body,
            color: scheme.onSurface,
          ),
          decoration: InputDecoration(
            hintText: label,
            hintStyle: TextStyle(color: colors.mutedText),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 14,
            ),
            suffixIcon: onTap != null
                ? const Icon(
                    Icons.chevron_right_rounded,
                    color: Color(0xFFFFC107),
                  )
                : null,
          ),
        ),
        const SizedBox(height: 20),
      ],
    );
  }

  Widget _buildGenderOption(String title, String value) {
    final isSelected = _selectedGender == value;
    return Semantics(
      button: true,
      selected: isSelected,
      inMutuallyExclusiveGroup: true,
      label: title,
      child: InkWell(
        onTap: () => setState(() => _selectedGender = value),
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 20,
                height: 20,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: isSelected
                      ? const Color(0xFFFFC107)
                      : const Color(0xFFEEEEEE),
                ),
                child: isSelected
                    ? Center(
                        child: Container(
                          width: 8,
                          height: 8,
                          decoration: const BoxDecoration(
                            color: Colors.white,
                            shape: BoxShape.circle,
                          ),
                        ),
                      )
                    : null,
              ),
              const SizedBox(width: 8),
              ExcludeSemantics(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontSize: BulkaTypeScale.body,
                    color: Color(0xFF6D3317),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: SafeArea(
        child: Column(
          children: [
            // Top Bar
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
              child: Row(
                children: [
                  IconButton(
                    icon: Icon(
                      Icons.arrow_back_ios_new_rounded,
                      color: colors.brandBrown,
                      size: 20,
                    ),
                    onPressed: widget.onBack,
                    tooltip: 'back_tooltip'.tr,
                  ),
                  Expanded(
                    child: Center(
                      child: _BulkaPageTitle(
                        'personal_title'.tr,
                        color: scheme.onSurface,
                      ),
                    ),
                  ),
                  const SizedBox(width: 48), // Balance for centering
                ],
              ),
            ),

            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(
                  horizontal: 24,
                  vertical: 16,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Avatar
                    Center(
                      child: Container(
                        width: 80,
                        height: 80,
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFC107),
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 4),
                          boxShadow: const [
                            BoxShadow(
                              color: Color(0x1A000000),
                              blurRadius: 10,
                              offset: Offset(0, 4),
                            ),
                          ],
                        ),
                        child: const Icon(
                          Icons.person_rounded,
                          color: Colors.white,
                          size: 40,
                        ),
                      ),
                    ),
                    const SizedBox(height: 32),

                    // Gender Selection
                    Text(
                      'gender_label'.tr,
                      style: TextStyle(
                        color: scheme.onSurface,
                        fontSize: BulkaTypeScale.body,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        _buildGenderOption('gender_male'.tr, 'male'),
                        const SizedBox(width: 32),
                        _buildGenderOption('gender_female'.tr, 'female'),
                      ],
                    ),
                    const SizedBox(height: 24),

                    // Name and Last Name
                    Row(
                      children: [
                        Expanded(
                          child: _buildTextField(
                            'name_label'.tr,
                            _nameController,
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: _buildTextField(
                            'surname_label'.tr,
                            _lastNameController,
                          ),
                        ),
                      ],
                    ),

                    // Date of Birth
                    _buildDateField(),

                    _buildTextField(
                      'email_label'.tr,
                      _emailController,
                      keyboardType: TextInputType.emailAddress,
                      badge: widget.customer.emailVerified
                          ? Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 3,
                              ),
                              decoration: BoxDecoration(
                                color: _successGreen.withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(
                                  BulkaRadii.control,
                                ),
                              ),
                              child: Text(
                                'email_verified'.tr,
                                style: const TextStyle(
                                  fontFamily: _headingFont,
                                  color: _successGreen,
                                  fontSize: BulkaTypeScale.caption,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            )
                          : null,
                    ),

                    // City Dropdown
                    _buildCityDropdown(),

                    const SizedBox(height: 12),

                    // Save Button
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: GradientButton(
                        onPressed: _saveProfile,
                        loading: _isLoading,
                        child: Text(
                          'save_btn'.tr,
                          style: const TextStyle(
                            fontFamily: _headingFont,
                            fontSize: BulkaTypeScale.body,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),

                    const SizedBox(height: 24),

                    // Delete Account Button
                    Center(
                      child: TextButton(
                        onPressed: _isLoading ? null : _deleteAccount,
                        child: Text(
                          'delete_account'.tr,
                          style: const TextStyle(
                            color: Color(0xFFD32F2F),
                            fontSize: BulkaTypeScale.body,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),

                    const SizedBox(height: 40),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
