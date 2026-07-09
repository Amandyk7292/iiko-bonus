part of '../main.dart';

class PersonalDataScreen extends StatefulWidget {
  const PersonalDataScreen({
    required this.customer,
    required this.onBack,
    required this.onProfileUpdated,
    super.key,
  });

  final Customer customer;
  final VoidCallback onBack;
  final Future<void> Function() onProfileUpdated;

  @override
  State<PersonalDataScreen> createState() => _PersonalDataScreenState();
}

class _PersonalDataScreenState extends State<PersonalDataScreen> {
  late TextEditingController _nameController;
  late TextEditingController _lastNameController;
  late TextEditingController _emailController;
  late TextEditingController _regionController;
  
  String? _selectedGender;
  String? _birthDate;
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.customer.name == 'Гость' ? '' : widget.customer.name);
    _lastNameController = TextEditingController(text: widget.customer.lastName ?? '');
    _emailController = TextEditingController(text: widget.customer.email ?? '');
    _regionController = TextEditingController(text: widget.customer.region ?? '');
    
    _selectedGender = widget.customer.gender;
    _birthDate = widget.customer.birthDate;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _lastNameController.dispose();
    _emailController.dispose();
    _regionController.dispose();
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
      await api.updateProfile(
        phone: widget.customer.phone,
        name: _nameController.text.trim(),
        lastName: _lastNameController.text.trim(),
        gender: _selectedGender,
        birthDate: _birthDate,
        email: _emailController.text.trim(),
        region: _regionController.text.trim(),
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
        await api.deleteAccount(widget.customer.phone);
        await prefs.remove('auth_token');
        await prefs.remove('auth_phone');
        if (mounted) {
          Navigator.pushAndRemoveUntil(
            context,
            MaterialPageRoute(builder: (_) => const LoginScreen()),
            (route) => false,
          );
        }
      } catch (e) {
        _showInfoMessage('Ошибка: ${e.toString()}', isError: true);
        if (mounted) setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _selectDate() async {
    final initialDate = _birthDate != null && _birthDate!.isNotEmpty
        ? DateTime.tryParse(_birthDate!) ?? DateTime.now()
        : DateTime(1990, 1, 1);
        
    final picked = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: DateTime(1900),
      lastDate: DateTime.now(),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.light(
              primary: Color(0xFFDEC588),
              onPrimary: Colors.white,
              onSurface: Color(0xFF231007),
            ),
          ),
          child: child!,
        );
      },
    );
    if (picked != null) {
      setState(() {
        _birthDate = "\${picked.year.toString().padLeft(4, '0')}-\${picked.month.toString().padLeft(2, '0')}-\${picked.day.toString().padLeft(2, '0')}";
      });
    }
  }

  String _formatDate(String? dateString) {
    if (dateString == null || dateString.isEmpty) return '';
    try {
      final parts = dateString.split('T')[0].split('-');
      if (parts.length == 3) {
        return '\${parts[2]}.\${parts[1]}.\${parts[0]}';
      }
    } catch (_) {}
    return dateString;
  }

  Widget _buildTextField(String label, TextEditingController controller, {bool readOnly = false, VoidCallback? onTap}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
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
                  ? const Icon(Icons.chevron_right_rounded, color: Color(0xFFC5A059))
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
              color: isSelected ? const Color(0xFFDEC588) : const Color(0xFFEEEEEE),
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
                    icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Color(0xFFC5A059), size: 20),
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
                          color: const Color(0xFFDEC588),
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
                    _buildTextField(
                      'Дата рождения',
                      TextEditingController(text: _formatDate(_birthDate)),
                      readOnly: true,
                      onTap: _selectDate,
                    ),

                    // Email
                    _buildTextField('E-mail', _emailController),

                    // Region
                    _buildTextField('Регион', _regionController),

                    const SizedBox(height: 12),

                    // Save Button
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: ElevatedButton(
                        onPressed: _isLoading ? null : _saveProfile,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFFDEC588),
                          foregroundColor: Colors.white,
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(22),
                          ),
                        ),
                        child: _isLoading
                            ? const SizedBox(
                                width: 24,
                                height: 24,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                                ),
                              )
                            : const Text(
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
