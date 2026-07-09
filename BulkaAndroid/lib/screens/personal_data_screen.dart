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
  
  String? _selectedGender;
  String? _selectedCity;
  String? _birthDate;
  bool _isLoading = false;
  List<City> _cities = [];

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.customer.name == 'Гость' ? '' : widget.customer.name);
    _lastNameController = TextEditingController(text: widget.customer.lastName ?? '');
    _selectedCity = widget.customer.region;
    
    _selectedGender = widget.customer.gender;
    _birthDate = widget.customer.birthDate;
    
    // Convert stored date (YYYY-MM-DD) to display format (DD.MM.YYYY)
    _birthDateController = TextEditingController(text: _formatDateForDisplay(_birthDate));
    
    _loadCities();
  }

  Future<void> _loadCities() async {
    try {
      final cities = await widget.api.getCities();
      if (mounted) {
        setState(() {
          _cities = cities;
          // Validate selected city
          if (_selectedCity != null && _selectedCity!.isNotEmpty && !_cities.any((c) => c.name == _selectedCity)) {
             // Keep it if it's custom, or we can clear it. Better to keep it so data is not lost.
          }
        });
      }
    } catch (e) {
      debugPrint('Failed to load cities: $e');
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _lastNameController.dispose();
    _birthDateController.dispose();
    super.dispose();
  }

  void _showInfoMessage(String message, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? Colors.red.shade800 : Colors.green.shade800,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  Future<void> _saveProfile() async {
    setState(() => _isLoading = true);
    try {
      await widget.api.updateProfile(
        phone: widget.customer.phone,
        name: _nameController.text.trim(),
        lastName: _lastNameController.text.trim(),
        gender: _selectedGender,
        birthDate: _birthDate,
        region: _selectedCity ?? widget.customer.region ?? '',
      );
      
      await widget.onProfileUpdated();
      _showInfoMessage('Профиль успешно сохранен!');
      widget.onBack();
    } catch (e) {
      _showInfoMessage('Ошибка: ${e.toString()}', isError: true);
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
        title: const Text('Удаление аккаунта', style: TextStyle(fontFamily: _headingFont)),
        content: const Text('Вы уверены, что хотите удалить свой аккаунт? Это действие необратимо, и все ваши накопленные баллы сгорят.'),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Отмена', style: TextStyle(color: Colors.grey)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Удалить', style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold)),
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
        _showInfoMessage('Ошибка: ${e.toString()}', isError: true);
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
    if (parts.length == 3 && parts[0].length == 2 && parts[1].length == 2 && parts[2].length == 4) {
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
    return Padding(
      padding: const EdgeInsets.only(bottom: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Город',
            style: TextStyle(
              color: Color(0xFF231007),
              fontSize: 15,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: const Color(0xFFE5D5C5).withOpacity(0.5),
                width: 1.5,
              ),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFFC66A25).withOpacity(0.04),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                isExpanded: true,
                value: _selectedCity?.isNotEmpty == true ? _selectedCity : null,
                hint: const Text('Выберите город', style: TextStyle(color: Color(0x66231007), fontSize: 16)),
                icon: const Icon(Icons.keyboard_arrow_down_rounded, color: Color(0xFFC66A25)),
                dropdownColor: Colors.white,
                borderRadius: BorderRadius.circular(16),
                items: [
                  if (_selectedCity != null && _selectedCity!.isNotEmpty && !_cities.any((c) => c.name == _selectedCity))
                    DropdownMenuItem<String>(
                      value: _selectedCity,
                      child: Text(_selectedCity!, style: const TextStyle(color: Color(0xFF231007), fontSize: 16)),
                    ),
                  ..._cities.map((city) {
                    return DropdownMenuItem<String>(
                      value: city.name,
                      child: Text(city.name, style: const TextStyle(color: Color(0xFF231007), fontSize: 16)),
                    );
                  })
                ],
                onChanged: (value) {
                  setState(() {
                    _selectedCity = value;
                  });
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDateField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Дата рождения',
          style: TextStyle(
            color: Color(0xFF231007),
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFF3F3F3)),
          ),
          child: TextField(
            controller: _birthDateController,
            keyboardType: TextInputType.number,
            onChanged: _onBirthDateChanged,
            style: const TextStyle(
              fontSize: 16,
              color: Color(0xFF6D3317),
            ),
            decoration: InputDecoration(
              hintText: 'ДД.ММ.ГГГГ',
              hintStyle: TextStyle(color: const Color(0xFF6D3317).withValues(alpha: 0.3)),
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              border: InputBorder.none,
            ),
          ),
        ),
        const SizedBox(height: 16),
      ],
    );
  }

  Widget _buildTextField(String label, TextEditingController controller, {bool readOnly = false, VoidCallback? onTap, Function(String)? onChanged, TextInputType? keyboardType, Widget? badge}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label,
              style: const TextStyle(
                color: Color(0xFF231007),
                fontSize: 15,
                fontWeight: FontWeight.w600,
              ),
            ),
            if (badge != null) badge,
          ],
        ),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFF3F3F3)),
          ),
          child: TextField(
            controller: controller,
            readOnly: readOnly,
            onTap: onTap,
            style: const TextStyle(
              fontSize: 16,
              color: Color(0xFF6D3317),
            ),
            decoration: InputDecoration(
              hintText: label,
              hintStyle: TextStyle(color: const Color(0xFF6D3317).withOpacity(0.3)),
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              border: InputBorder.none,
              suffixIcon: onTap != null 
                  ? const Icon(Icons.chevron_right_rounded, color: Color(0xFFFFC107))
                  : null,
            ),
          ),
        ),
        const SizedBox(height: 20),
      ],
    );
  }

  Widget _buildGenderOption(String title, String value) {
    final isSelected = _selectedGender == value;
    return GestureDetector(
      onTap: () {
        setState(() {
          _selectedGender = value;
        });
      },
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 20,
            height: 20,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: isSelected ? const Color(0xFFFFC107) : const Color(0xFFEEEEEE),
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
          Text(
            title,
            style: const TextStyle(
              fontSize: 15,
              color: Color(0xFF6D3317),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFCFBF9),
      body: SafeArea(
        child: Column(
          children: [
            // Top Bar
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
              child: Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Color(0xFF6D3317), size: 20),
                    onPressed: widget.onBack,
                  ),
                  const Expanded(
                    child: Center(
                      child: Text(
                        'Личные данные',
                        style: TextStyle(
                          color: Color(0xFF231007),
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 48), // Balance for centering
                ],
              ),
            ),

            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
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
                    const Text(
                      'Выберите пол',
                      style: TextStyle(
                        color: Color(0xFF231007),
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        _buildGenderOption('Мужской', 'male'),
                        const SizedBox(width: 32),
                        _buildGenderOption('Женский', 'female'),
                      ],
                    ),
                    const SizedBox(height: 24),

                    // Name and Last Name
                    Row(
                      children: [
                        Expanded(
                          child: _buildTextField('Имя', _nameController),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: _buildTextField('Фамилия', _lastNameController),
                        ),
                      ],
                    ),

                    // Date of Birth
                    _buildDateField(),

                    // City Dropdown
                    if (_cities.isNotEmpty) _buildCityDropdown(),

                    const SizedBox(height: 12),

                    // Save Button
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: GradientButton(
                        onPressed: _saveProfile,
                        loading: _isLoading,
                        child: const Text(
                          'Сохранить',
                          style: TextStyle(
                            fontSize: 16,
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
                        child: const Text(
                          'Удалить аккаунт',
                          style: TextStyle(
                            color: Color(0xFFD32F2F),
                            fontSize: 15,
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
