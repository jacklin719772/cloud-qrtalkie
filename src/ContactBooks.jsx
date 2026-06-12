import React, { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import apiClient from './apiClient.js';

const ContactBooks = forwardRef(({ tenantName }, ref) => {
  const [contactBooks, setContactBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [assignmentFilter, setAssignmentFilter] = useState('all');
  const [assignedBookIds, setAssignedBookIds] = useState(new Set());
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const dropdownAnchorRef = useRef(null);
  const dropdownMenuRef = useRef(null);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newBookForm, setNewBookForm] = useState({ name: '', description: tenantName || '', accountIds: [], assignedAccountIds: [] });
  const [tenantAccounts, setTenantAccounts] = useState([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [accountSearchKeyword, setAccountSearchKeyword] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [detailBook, setDetailBook] = useState(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editBookForm, setEditBookForm] = useState({ id: '', name: '', description: '', accountIds: [], assignedAccountIds: [] });
  const [assignDrawerOpen, setAssignDrawerOpen] = useState(false);
  const [assignBook, setAssignBook] = useState(null);
  const [assignAccounts, setAssignAccounts] = useState([]); // [{ sipUserId, username, displayName, selected: bool }]
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignSearch, setAssignSearch] = useState('');
  const [assignFilter, setAssignFilter] = useState('all'); // all | assigned | unassigned

  const filteredTenantAccounts = useMemo(() => {
    const keyword = accountSearchKeyword.trim().toLowerCase();
    if (!keyword) return tenantAccounts;
    return tenantAccounts.filter(acc =>
      (acc.username && acc.username.toLowerCase().includes(keyword)) ||
      (acc.displayName && acc.displayName.toLowerCase().includes(keyword)) ||
      (acc.email && acc.email.toLowerCase().includes(keyword)) ||
      (acc.phone && acc.phone.toLowerCase().includes(keyword))
    );
  }, [tenantAccounts, accountSearchKeyword]);

  useEffect(() => {
    fetchContactBooks();
    fetchCurrentUser();
    
    const fetchAssignmentStatus = async () => {
      try {
        const data = await apiClient.get('/tenant/sip-accounts');
        if (Array.isArray(data.accounts)) {
          const ids = new Set();
          data.accounts.forEach(acc => {
            if (acc.contactBookId) {
              ids.add(acc.contactBookId);
            }
          });
          setAssignedBookIds(ids);
        }
      } catch (err) {
        console.error('Failed to fetch account assignment status:', err);
      }
    };
    fetchAssignmentStatus();
  }, []);

  const fetchCurrentUser = async () => {
    try {
      const data = await apiClient.get('/me');
      setCurrentUser(data);
    } catch (err) {
      console.error('Failed to fetch current user:', err);
    }
  };

  const fetchContactBooks = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get('/contact-books');
      setContactBooks(data.contactBooks || []);
    } catch (err) {
      console.error('Failed to fetch contact books:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchKeyword, assignmentFilter]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!event.target.closest('.contact-books-more-menu') && !event.target.closest('.dropdown-menu-portal')) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!openDropdownId || !dropdownAnchorRef.current) return undefined;
    const updatePosition = () => {
      const rect = dropdownAnchorRef.current.getBoundingClientRect();
      const menuWidth = 150;
      const viewportPadding = 12;
      let left = rect.right - menuWidth;
      if (left < viewportPadding) left = viewportPadding;
      if (left + menuWidth > window.innerWidth - viewportPadding) {
        left = window.innerWidth - viewportPadding - menuWidth;
      }

      const menuHeight = dropdownMenuRef.current?.offsetHeight || 120;
      let top = rect.bottom + 4;
      if (top + menuHeight > window.innerHeight - viewportPadding) {
        top = rect.top - menuHeight - 4;
      }
      if (top < viewportPadding) top = viewportPadding;

      setDropdownPosition({ top, left });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [openDropdownId]);

  const bookStats = useMemo(() => {
    let assigned = 0;
    let unassigned = 0;
    contactBooks.forEach((book) => {
      if ((book.entryCount || 0) > 0) {
        assigned++;
      } else {
        unassigned++;
      }
    });
    return { total: contactBooks.length, assigned, unassigned };
  }, [contactBooks]);

  const handleCreateRef = useRef(null);
  const handleValidateRef = useRef(null);
  const [validateResult, setValidateResult] = useState(null);
  const [isValidating, setIsValidating] = useState(false);

  const openAssignDrawer = async (book) => {
    setOpenDropdownId(null);
    setAssignBook(book);
    setAssignLoading(true);
    setAssignSearch('');
    setAssignFilter('all');
    setAssignDrawerOpen(true);
    try {
      const data = await apiClient.get('/contact-books/available-accounts');
      const all = (data.accounts || []).filter(a => a.status === 'active' || a.status === 'pending');
      const detail = await apiClient.get(`/contact-books/${book.id}`);
      const assignedIds = new Set((detail.contactBook?.accountIds || []).map(Number));
      setAssignAccounts(all.map(a => ({ ...a, _sel: assignedIds.has(a.sipUserId) })));
    } catch (e) { console.error(e); }
    setAssignLoading(false);
  };

  const handleAssignSave = async () => {
    if (!assignBook) return;
    const selIds = assignAccounts.filter(a => a._sel).map(a => a.sipUserId);
    try {
      await apiClient.put(`/contact-books/${assignBook.id}`, { name: assignBook.name, description: assignBook.description || '', accountIds: selIds });
      setAssignDrawerOpen(false);
      fetchContactBooks();
    } catch (e) { window.alert(e.message || '儲存失敗'); }
  };

  useImperativeHandle(ref, () => ({
    handleCreate: () => { if (handleCreateRef.current) handleCreateRef.current(); },
    handleValidate: () => { if (handleValidateRef.current) handleValidateRef.current(); },
  }), []);

  const filteredBooks = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    return contactBooks.filter(book => {
      const matchesKeyword = !keyword || book.name.toLowerCase().includes(keyword) || (book.description && book.description.toLowerCase().includes(keyword));
      if (!matchesKeyword) return false;

      if (assignmentFilter === 'all') return true;

      const isAssigned = assignedBookIds.has(book.id);
      if (assignmentFilter === 'assigned') return isAssigned;
      if (assignmentFilter === 'unassigned') return !isAssigned;
      
      return true;
    });
  }, [contactBooks, searchKeyword, assignmentFilter, assignedBookIds]);

  const effectivePageSize = pageSize > 0 ? pageSize : filteredBooks.length;
  const totalPages = Math.max(1, Math.ceil(filteredBooks.length / effectivePageSize));
  const paginatedBooks = pageSize > 0 ? filteredBooks.slice((currentPage - 1) * pageSize, currentPage * pageSize) : filteredBooks;

  const fetchContactBookDetails = async (id) => {
    setIsLoadingDetail(true);
    try {
      const data = await apiClient.get(`/contact-books/${id}`);
      setDetailBook(prev => ({ ...prev, ...data.contactBook }));
    } catch (err) {
      console.error('Failed to fetch contact book details:', err);
      window.alert(err.message || '獲取通訊錄詳情失敗');
      setIsDetailModalOpen(false);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleAction = async (action, book) => {
    setOpenDropdownId(null);
    if (action === 'manage_contacts') {
      setDetailBook({ ...book, accountIds: [] });
      setIsDetailModalOpen(true);
      fetchContactBookDetails(book.id);
      if (tenantAccounts.length === 0) fetchTenantAccounts();
    } else if (action === 'edit') {
      setIsLoadingDetail(true);
      setIsEditModalOpen(true);
      setEditBookForm({ id: book.id, name: book.name || '', description: book.description || '', accountIds: [], assignedAccountIds: [] });
      fetchTenantAccounts();
      try {
        const data = await apiClient.get(`/contact-books/${book.id}`);
        const contactBook = data.contactBook || {};
        setEditBookForm({
          id: contactBook.id || book.id,
          name: contactBook.name || '',
          description: contactBook.description || '',
          accountIds: contactBook.accountIds || [],
          assignedAccountIds: contactBook.assignedAccountIds || []
        });
      } catch (err) {
        console.error('Failed to fetch contact book details:', err);
        window.alert(err.message || '獲取通訊錄詳情失敗');
        setIsEditModalOpen(false);
      } finally {
        setIsLoadingDetail(false);
      }
    } else if (action === 'delete') {
      if (window.confirm(`確定要刪除通訊錄「${book.name}」吗？`)) {
        try {
          await apiClient.delete(`/contact-books/${book.id}`);
          setContactBooks(currentBooks => currentBooks.filter(b => b.id !== book.id));
        } catch (err) {
          console.error('Failed to delete contact book:', err);
          window.alert(err.message || '刪除失敗');
        }
      }
    }
  };

  const handleCreate = () => {
    setNewBookForm({ name: '', description: tenantName || '', accountIds: [], assignedAccountIds: [] });
    setAccountSearchKeyword('');
    setIsCreateModalOpen(true);
    fetchTenantAccounts();
  };
  handleCreateRef.current = handleCreate;

  const handleValidate = async () => {
    setIsValidating(true);
    setValidateResult(null);
    try {
      const res = await apiClient.get('/contact-books/validate');
      setValidateResult(res);
    } catch (err) {
      setValidateResult({ success: false, flexisipError: err.message || '校验失败' });
    } finally {
      setIsValidating(false);
    }
  };
  handleValidateRef.current = handleValidate;

  const fetchTenantAccounts = async () => {
    setIsLoadingAccounts(true);
    try {
      const data = await apiClient.get('/contact-books/available-accounts');
      const activeAccounts = (data.accounts || []).filter(acc => acc.status === 'active' || acc.status === 'pending');
      setTenantAccounts(activeAccounts);
      return activeAccounts;
    } catch (error) {
      console.error('Failed to fetch accounts:', error);
      return [];
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  const handleToggleAccount = (sipUserId) => {
    setNewBookForm(prev => {
      const newIds = new Set(prev.accountIds);
      if (newIds.has(sipUserId)) {
        newIds.delete(sipUserId);
      } else {
        newIds.add(sipUserId);
      }
      return { ...prev, accountIds: Array.from(newIds) };
    });
  };

  const toggleNewBookAccount = (field, sipUserId) => {
    setNewBookForm(prev => {
      const ids = new Set(prev[field] || []);
      if (ids.has(sipUserId)) ids.delete(sipUserId);
      else ids.add(sipUserId);
      return { ...prev, [field]: Array.from(ids) };
    });
  };

  const handleToggleAll = (e) => {
    if (e.target.checked) {
      const filteredIds = filteredTenantAccounts.map(a => a.sipUserId);
      setNewBookForm(prev => {
        const newIds = new Set([...prev.accountIds, ...filteredIds]);
        return { ...prev, accountIds: Array.from(newIds) };
      });
    } else {
      const filteredIds = new Set(filteredTenantAccounts.map(a => a.sipUserId));
      setNewBookForm(prev => ({
        ...prev,
        accountIds: prev.accountIds.filter(id => !filteredIds.has(id))
      }));
    }
  };

  const submitCreateContactBook = async (e) => {
    e.preventDefault();
    if (!newBookForm.name.trim()) return;
    setIsSaving(true);
    try {
      await apiClient.post('/contact-books', {
        name: newBookForm.name.trim(),
        description: newBookForm.description.trim(),
        accountIds: newBookForm.accountIds,
        assignedAccountIds: newBookForm.assignedAccountIds
      });
      setIsCreateModalOpen(false);
      setNewBookForm({ name: '', description: tenantName || '', accountIds: [], assignedAccountIds: [] });
      fetchContactBooks();
    } catch (err) {
      window.alert(err.message || '新增通訊錄失敗');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleEditAccount = (field, sipUserId) => {
    setEditBookForm(prev => {
      const ids = new Set(prev[field] || []);
      if (ids.has(sipUserId)) ids.delete(sipUserId);
      else ids.add(sipUserId);
      return { ...prev, [field]: Array.from(ids) };
    });
  };

  const submitEditContactBook = async (e) => {
    e.preventDefault();
    if (!editBookForm.name.trim() || !editBookForm.id) return;
    if (!window.confirm('確定要儲存通訊錄修改嗎？')) return;
    setIsSaving(true);
    try {
      await apiClient.put(`/contact-books/${editBookForm.id}`, {
        name: editBookForm.name.trim(),
        description: editBookForm.description.trim(),
        accountIds: editBookForm.accountIds,
        assignedAccountIds: editBookForm.assignedAccountIds
      });
      setIsEditModalOpen(false);
      fetchContactBooks();
    } catch (err) {
      window.alert(err.message || '儲存通訊錄失敗');
    } finally {
      setIsSaving(false);
    }
  };

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10) || '-';
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  const renderReadonlyAccountList = (accounts, emptyText) => {
    if (!accounts || accounts.length === 0) {
      return <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>{emptyText}</div>;
    }

    return accounts.map(acc => (
      <div key={acc.sipUserId} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderBottom: '1px solid #1f2937' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '14px', fontWeight: 600, flex: '0 0 auto' }}>
          {(acc.displayName || acc.username || 'U').charAt(0).toUpperCase()}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: '14px', color: '#e5e7eb', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.displayName || acc.username || '-'}</span>
          <span style={{ fontSize: '12px', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.username || '-'} | {acc.domain || '-'}</span>
        </div>
      </div>
    ));
  };

  const renderEditableAccountList = (accounts, selectedIds, onToggle, emptyText) => {
    if (isLoadingAccounts) {
      return <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>載入帳號中...</div>;
    }
    if (!accounts || accounts.length === 0) {
      return <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>{emptyText}</div>;
    }

    const selectedSet = new Set(selectedIds || []);
    const sortedAccounts = [...accounts].sort((left, right) => {
      const leftSelected = selectedSet.has(left.sipUserId);
      const rightSelected = selectedSet.has(right.sipUserId);
      if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
      return String(left.username || '').localeCompare(String(right.username || ''), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
    });

    return sortedAccounts.map(acc => (
      <label key={acc.sipUserId} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderBottom: '1px solid #1f2937', cursor: 'pointer' }}>
        <input type="checkbox" checked={selectedSet.has(acc.sipUserId)} onChange={() => onToggle(acc.sipUserId)} style={{ cursor: 'pointer' }} />
        <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '14px', fontWeight: 600, flex: '0 0 auto' }}>
          {(acc.displayName || acc.username || 'U').charAt(0).toUpperCase()}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: '14px', color: '#e5e7eb', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.displayName || acc.username || '-'}</span>
          <span style={{ fontSize: '12px', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.username || '-'} | {acc.domain || '-'}</span>
        </div>
      </label>
    ));
  };

  return (
    <section className="view active" id="contact-books-management" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#0f172a' }}>
      <style>{`
        #contact-books-management .contact-book-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 22px 24px;
          margin-bottom: 24px;
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 14px;
          box-shadow: none;
        }
        #contact-books-management .contact-book-filter-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        #contact-books-management .contact-book-search {
          position: relative;
          width: 280px;
        }
        #contact-books-management .contact-book-search input {
          width: 100%;
          height: 46px;
          padding: 0 16px;
          border-radius: 9px;
          border: 1px solid #374151;
          background: #1a2332;
          color: #d1d5db;
          font-size: 13px;
          outline: none;
        }
        #contact-books-management .contact-book-status-select {
          height: 46px;
          min-width: 112px;
          width: 120px;
          padding: 0 12px;
          border-radius: 9px;
          border: 1px solid #374151;
          background: #1a2332;
          color: #d1d5db;
          font-size: 13px;
          outline: none;
          cursor: pointer;
        }
        #contact-books-management .contact-book-stats {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex: 0 0 auto;
          flex-wrap: nowrap;
          white-space: nowrap;
          margin-left: auto;
        }
        #contact-books-management .contact-book-stat-pill {
          height: 34px;
          padding: 0 12px;
          border-radius: 999px;
          background: #1a2332;
          border: 1px solid #1f2937;
          color: #9ca3af;
          font-size: 13px;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          flex: 0 0 auto;
          white-space: nowrap;
        }
        #contact-books-management .contact-book-stat-pill strong {
          color: #f3f4f6;
          font-size: 13px;
          font-weight: 700;
        }
        #contact-books-management .contact-book-table-card {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 14px;
          box-shadow: none;
          overflow: hidden;
          padding: 0 24px;
        }
        #contact-books-management .contact-book-table-wrapper {
          width: 100%;
          flex: 1;
          min-height: 0;
          overflow: auto;
        }
        #contact-books-management .contact-book-table {
          width: 100%;
          min-width: 800px;
          border-collapse: collapse;
          font-size: 13px;
        }
        #contact-books-management .contact-book-table thead {
          position: sticky;
          top: 0;
          z-index: 2;
          background: #1a2332;
        }
        #contact-books-management .contact-book-table th {
          height: 56px;
          padding: 0 22px;
          text-align: left;
          color: #9ca3af;
          font-weight: 600;
          border-bottom: 1px solid #e2e8f0;
        }
        #contact-books-management .contact-book-table td {
          height: 64px;
          padding: 0 22px;
          color: #d1d5db;
          border-bottom: 1px solid #e2e8f0;
        }
        #contact-books-management .contact-book-table-footer {
          min-height: 74px;
          padding: 0 30px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #1a2332;
        }
        #contact-books-management .contact-book-total {
          color: #9ca3af;
          font-size: 13px;
        }
        #contact-books-management .contact-book-pagination {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        #contact-books-management .contact-book-page-size {
          height: 38px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid #374151;
          background: #1a2332;
          color: #9ca3af;
          font-size: 11px;
          display: inline-flex;
          align-items: center;
        }
        #contact-books-management .contact-book-page-btn,
        #contact-books-management .contact-book-page-current {
          width: 38px;
          height: 38px;
          border-radius: 8px;
          border: 1px solid #374151;
          background: #1a2332;
          color: #9ca3af;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
        }
        #contact-books-management .contact-book-page-current {
          border-color: #60a5fa;
          color: #60a5fa;
          background: #1e3a5f;
          font-weight: 600;
        }
        #contact-books-management .contact-book-page-btn {
          cursor: pointer;
        }
        #contact-books-management .contact-book-page-btn:disabled {
          color: #4b5563;
          cursor: not-allowed;
          background: #1a2332;
        }
        .dropdown-menu-portal { position: fixed; width: 150px; background: #1a2332; border: 1px solid #1f2937; border-radius: 6px; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4); padding: 6px; z-index: 2147483647; }
        .dropdown-menu-portal .dropdown-item { display: block; width: 100%; border: 0; background: transparent; color: #d1d5db; text-align: left; border-radius: 4px; padding: 8px 10px; font-size: 13px; cursor: pointer; }
        .dropdown-menu-portal .dropdown-item:hover { background: #1f2937; color: #f3f4f6; }
        .dropdown-menu-portal .dropdown-item-danger { color: #ef4444; }
        .dropdown-menu-portal .dropdown-item-danger:hover { background: #3b1111; color: #fca5a5; }
      
        #contact-books-management .contact-book-table th { background: #1a2332 !important; }
        #contact-books-management .contact-book-search input { background: #1a2332; }
        #contact-books-management .contact-book-search input::placeholder { color: #6b7280; }
        #contact-books-management .contact-book-search input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.12); }
        #contact-books-management .contact-book-status-select { background: #1a2332; color: #e5e7eb; }
        #contact-books-management .contact-book-table-wrapper { scrollbar-width: none; }
        #contact-books-management .contact-book-table-wrapper::-webkit-scrollbar { display: none; }
        #contact-books-management .contact-book-page-btn:hover:not(:disabled) { background: #374151; color: #f3f4f6; }
        #contact-books-management .contact-book-table tbody tr { background: #111827; }
        #contact-books-management .contact-book-table tbody tr:hover { background: #1e293b; }
        #contact-books-management .ghost-btn { background: #374151 !important; color: #d1d5db !important; border: 1px solid #4b5563 !important; border-radius: 8px; cursor: pointer; }
        #contact-books-management .ghost-btn:hover { background: #4b5563 !important; color: #f3f4f6 !important; }
`}</style>
      <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '0', paddingBottom: '0' }}>
        <div className="contact-book-toolbar">
          <div className="contact-book-filter-left">
            <div className="contact-book-search">
              <input
                type="search"
                placeholder="搜尋通訊錄名稱或描述"
                value={searchKeyword}
                onChange={(event) => setSearchKeyword(event.target.value)}
              />
            </div>
            <select
              className="contact-book-status-select"
              value={assignmentFilter}
              onChange={(e) => setAssignmentFilter(e.target.value)}
            >
              <option value="all">全部狀態</option>
              <option value="assigned">已分配</option>
              <option value="unassigned">未分配</option>
            </select>
          </div>
          <div className="contact-book-stats">
            <span className="contact-book-stat-pill">全部<strong>{bookStats.total}</strong></span>
            <span className="contact-book-stat-pill">有成員<strong>{bookStats.assigned}</strong></span>
            <span className="contact-book-stat-pill">無成員<strong>{bookStats.unassigned}</strong></span>
          </div>
        </div>

        <div className="contact-book-table-card">
          <div className="contact-book-table-wrapper">
            <table className="contact-book-table" style={{ minWidth: '1000px' }}>
              <thead>
                <tr>
                  <th style={{ width: '18%' }}>通訊錄名稱</th>
                  <th style={{ width: '20%' }}>描述</th>
                  <th style={{ width: '10%' }}>包含帳號</th>
                  <th style={{ width: '10%' }}>已分配</th>
                  <th style={{ width: '12%' }}>創建人</th>
                  <th style={{ width: '12%' }}>創建時間</th>
                  <th style={{ width: '160px', minWidth: '160px', textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {paginatedBooks.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b' }}>
                      {loading ? '載入中...' : '暫無通訊錄數據'}
                    </td>
                  </tr>
                ) : (
                  paginatedBooks.map((book) => (
                    <tr key={book.id}>
                      <td style={{ fontWeight: 500 }}>{book.name}</td>
                      <td style={{ maxWidth: '400px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{book.description || '-'}</td>
                      <td style={{ textAlign: 'center', color: (book.entryCount > 0) ? '#4ade80' : '#9ca3af', fontSize: '13px', fontWeight: 500 }}>
                        {book.entryCount || 0}
                      </td>
                      <td style={{ textAlign: 'center', color: (book.assignedCount > 0) ? '#93c5fd' : '#9ca3af', fontSize: '13px', fontWeight: 500 }}>
                        {book.assignedCount || 0}
                      </td>
                      <td>{book.creatorName || book.createdBy || book.creatorNickname || book.adminNickname || book.adminName || '系統'}</td>
                      <td>{formatDate(book.createdAt)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="row-actions contact-books-more-menu" style={{ display: 'inline-flex', gap: '8px' }}>
                          <button className="ghost-btn" type="button" onClick={() => handleAction('manage_contacts', book)}>詳情</button>
                          <button
                            className="ghost-btn"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              dropdownAnchorRef.current = event.currentTarget;
                              setOpenDropdownId((current) => (current === book.id ? null : book.id));
                            }}
                          >
                            更多
                          </button>
                          {openDropdownId === book.id && createPortal(
                            <div ref={dropdownMenuRef} className="dropdown-menu-portal" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                              <button type="button" className="dropdown-item" onClick={() => handleAction('manage_contacts', book)}>詳情</button>
                              <button type="button" className="dropdown-item" onClick={() => handleAction('edit', book)}>編輯</button>
                              <button type="button" className="dropdown-item" onClick={() => openAssignDrawer(book)}>分配</button>
                              <button type="button" className="dropdown-item dropdown-item-danger" onClick={() => handleAction('delete', book)}>刪除</button>
                            </div>,
                            document.body
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="contact-book-table-footer">
            <div className="contact-book-total">共 {filteredBooks.length} 筆記錄</div>
            <div className="contact-book-pagination">
              <select className="contact-book-page-size" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}>
                <option value={10}>10 條/頁</option>
                <option value={20}>20 條/頁</option>
                <option value={50}>50 條/頁</option>
                <option value={-1}>全部</option>
              </select>
              <button className="contact-book-page-btn" type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>‹</button>
              <span className="contact-book-page-current">{currentPage}</span>
              <button className="contact-book-page-btn" type="button" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}>›</button>
            </div>
          </div>
        </div>
      </div>
      {isCreateModalOpen && createPortal(
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.36)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2147483646 }}>
          <form onSubmit={submitCreateContactBook} style={{ width: 'min(680px, calc(100% - 32px))', backgroundColor: '#111827', borderRadius: '8px', border: '1px solid #4b5563', boxShadow: '0 24px 80px rgba(15, 23, 42, 0.5)', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #1f2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>新增通訊錄</h3>
              <button type="button" onClick={() => setIsCreateModalOpen(false)} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: '18px' }}>✕</button>
            </div>
            <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>名稱 <span style={{ color: '#ef4444' }}>*</span></span>
                  <input required value={newBookForm.name} onChange={(e) => setNewBookForm(p => ({ ...p, name: e.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', outline: 'none' }} placeholder="例如：開發部通訊錄" />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>描述</span>
                  <input type="text" value={newBookForm.description} onChange={(e) => setNewBookForm(p => ({ ...p, description: e.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', outline: 'none' }} placeholder="請輸入通訊錄描述..." />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', flex: 1, minHeight: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>通訊錄中包含的帳號 ({newBookForm.accountIds.length})</span>
                  <div style={{ border: '1px solid #1f2937', borderRadius: '6px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ overflowY: 'auto', flex: 1, minHeight: '320px', maxHeight: '50vh', scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
                      {renderEditableAccountList(
                        filteredTenantAccounts.filter(acc => acc.status === 'active' || acc.status === 'pending'),
                        newBookForm.accountIds,
                        (id) => toggleNewBookAccount('accountIds', id),
                        accountSearchKeyword ? '沒有符合條件的帳號' : '暫無可選擇帳號'
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>允許使用該通訊錄的帳號 ({newBookForm.assignedAccountIds.length})</span>
                  <div style={{ border: '1px solid #1f2937', borderRadius: '6px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ overflowY: 'auto', flex: 1, minHeight: '320px', maxHeight: '50vh', scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
                      {renderEditableAccountList(
                        filteredTenantAccounts.filter(acc => acc.status === 'active'),
                        newBookForm.assignedAccountIds,
                        (id) => toggleNewBookAccount('assignedAccountIds', id),
                        accountSearchKeyword ? '沒有符合條件的帳號' : '暫無啟用帳號可分配'
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ padding: '16px 20px', borderTop: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'flex-end', gap: '10px', flexShrink: 0 }}>
              <button type="button" onClick={() => setIsCreateModalOpen(false)} disabled={isSaving} style={{ padding: '8px 20px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#9ca3af', fontSize: '13px', cursor: 'pointer' }}>取消</button>
              <button type="submit" className="primary-btn" disabled={isSaving || !newBookForm.name.trim()}>{isSaving ? '保存中...' : '保存通訊錄'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}
      {isDetailModalOpen && detailBook && createPortal(
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.36)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2147483646 }} onClick={() => setIsDetailModalOpen(false)}>
          <div style={{ width: 'min(680px, calc(100% - 32px))', backgroundColor: '#111827', borderRadius: '8px', border: '1px solid #4b5563', boxShadow: '0 24px 80px rgba(15, 23, 42, 0.5)', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #1f2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>通訊錄詳情</h3>
              <button type="button" onClick={() => setIsDetailModalOpen(false)} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: '18px' }}>✕</button>
            </div>
            <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>名稱</span>
                  <div style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '14px' }}>{detailBook.name || '-'}</div>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>描述</span>
                  <div style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '14px', minHeight: '40px', wordBreak: 'break-all' }}>{detailBook.description || '-'}</div>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', flex: 1, minHeight: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>包含的帳號 ({detailBook.includedAccounts?.length || 0})</span>
                <div style={{ border: '1px solid #1f2937', borderRadius: '6px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ overflowY: 'auto', flex: 1, minHeight: '320px', maxHeight: '50vh' }}>
                    {isLoadingDetail ? (
                      <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>載入詳情中...</div>
                    ) : renderReadonlyAccountList(detailBook.includedAccounts, '該通訊錄暫無包含帳號')}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>已分配的帳號 ({detailBook.assignedAccounts?.length || 0})</span>
                <div style={{ border: '1px solid #1f2937', borderRadius: '6px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ overflowY: 'auto', flex: 1, minHeight: '320px', maxHeight: '50vh' }}>
                    {isLoadingDetail ? (
                      <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>載入詳情中...</div>
                    ) : renderReadonlyAccountList(detailBook.assignedAccounts, '該通訊錄暫無分配帳號')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>,
        document.body
      )}
      {isEditModalOpen && createPortal(
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.36)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2147483646 }} onClick={() => setIsEditModalOpen(false)}>
          <form onSubmit={submitEditContactBook} style={{ width: 'min(680px, calc(100% - 32px))', backgroundColor: '#111827', borderRadius: '8px', border: '1px solid #4b5563', boxShadow: '0 24px 80px rgba(15, 23, 42, 0.5)', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #1f2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>編輯通訊錄</h3>
              <button type="button" onClick={() => setIsEditModalOpen(false)} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: '18px' }}>✕</button>
            </div>
            <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>名稱 <span style={{ color: '#ef4444' }}>*</span></span>
                  <input required value={editBookForm.name} onChange={(event) => setEditBookForm(form => ({ ...form, name: event.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', outline: 'none', fontSize: '14px' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>描述</span>
                  <input value={editBookForm.description} onChange={(event) => setEditBookForm(form => ({ ...form, description: event.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', outline: 'none', fontSize: '14px' }} />
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <input
                  type="search"
                  placeholder="搜尋帳號、名稱、郵件或電話"
                  value={accountSearchKeyword}
                  onChange={(e) => setAccountSearchKeyword(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', outline: 'none', fontSize: '13px', width: '220px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', flex: 1, minHeight: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>包含的帳號 ({editBookForm.accountIds.length})</span>
                  <div style={{ border: '1px solid #1f2937', borderRadius: '6px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ overflowY: 'auto', flex: 1, minHeight: '320px', maxHeight: '50vh' }}>
                      {isLoadingDetail ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>載入詳情中...</div>
                      ) : renderEditableAccountList(
                        tenantAccounts.filter(acc => acc.status === 'active' || acc.status === 'pending'),
                        editBookForm.accountIds,
                        (id) => toggleEditAccount('accountIds', id),
                        '暫無可選擇帳號'
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>已分配的帳號 ({editBookForm.assignedAccountIds.length})</span>
                  <div style={{ border: '1px solid #1f2937', borderRadius: '6px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ overflowY: 'auto', flex: 1, minHeight: '320px', maxHeight: '50vh' }}>
                      {isLoadingDetail ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>載入詳情中...</div>
                      ) : renderEditableAccountList(
                        tenantAccounts.filter(acc => acc.status === 'active'),
                        editBookForm.assignedAccountIds,
                        (id) => toggleEditAccount('assignedAccountIds', id),
                        '暫無啟用帳號可分配'
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ padding: '16px 20px', borderTop: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'flex-end', gap: '10px', flexShrink: 0 }}>
              <button type="button" onClick={() => setIsEditModalOpen(false)} disabled={isSaving} style={{ padding: '8px 20px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#9ca3af', fontSize: '13px', cursor: 'pointer' }}>取消</button>
              <button type="submit" className="primary-btn" disabled={isSaving || isLoadingDetail || !editBookForm.name.trim()}>{isSaving ? '保存中...' : '保存'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}
      {/* 分配抽屜 */}
      {assignDrawerOpen && assignBook && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 2147483645, background: 'rgba(15,23,42,0.36)' }} onClick={() => setAssignDrawerOpen(false)} />
          <div style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 'min(520px, 90vw)', background: '#111827', zIndex: 2147483646, boxShadow: '-8px 0 32px rgba(15,23,42,0.5)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>分配帳號 — {assignBook.name}</h3>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '18px' }} onClick={() => setAssignDrawerOpen(false)}>✕</button>
            </div>
            <div style={{ padding: '12px 24px 0', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="contact-book-stat-pill">可選 <strong>{assignAccounts.filter(a => !a._sel).length}</strong></span>
                  <span className="contact-book-stat-pill">已選 <strong style={{ color: '#16a34a' }}>{assignAccounts.filter(a => a._sel).length}</strong></span>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {['all','assigned','unassigned'].map(f => (
                    <button key={f} type="button" onClick={() => setAssignFilter(f)}
                      style={{ padding: '4px 12px', borderRadius: '6px', border: '1px solid #374151', background: assignFilter === f ? '#3b82f6' : '#1f2937', color: assignFilter === f ? '#fff' : '#9ca3af', fontSize: '11px', cursor: 'pointer' }}>
                      {f === 'all' ? '全部' : f === 'assigned' ? '已分配' : '未分配'}
                    </button>
                  ))}
                  <button type="button" onClick={() => setAssignAccounts(prev => prev.map(a => ({ ...a, _sel: true })))} style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#9ca3af', fontSize: '11px', cursor: 'pointer' }}>全選</button>
                  <button type="button" onClick={() => setAssignAccounts(prev => prev.map(a => ({ ...a, _sel: false })))} style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#9ca3af', fontSize: '11px', cursor: 'pointer' }}>全不選</button>
                </div>
              </div>
              <input type="search" placeholder="搜尋帳號..." value={assignSearch} onChange={e => setAssignSearch(e.target.value)} style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', background: '#1a2332', color: '#e5e7eb', outline: 'none', marginBottom: '12px' }} />
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 16px' }}>
              {assignLoading ? <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>載入中...</div> : (() => {
                const filtered = assignAccounts.filter(a => {
                  if (assignFilter === 'assigned' && !a._sel) return false;
                  if (assignFilter === 'unassigned' && a._sel) return false;
                  if (assignSearch && !((a.username || '').toLowerCase().includes(assignSearch.toLowerCase()) || (a.displayName || '').toLowerCase().includes(assignSearch.toLowerCase()))) return false;
                  return true;
                });
                return filtered.length === 0 ? <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>無匹配帳號</div> : filtered.map(a => (
                  <label key={a.sipUserId} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '10px', cursor: 'pointer', background: a._sel ? '#0d2818' : '#1a2332', border: `1px solid ${a._sel ? '#065f46' : '#1f2937'}`, marginBottom: '6px' }}>
                    <input type="checkbox" checked={a._sel} onChange={() => setAssignAccounts(prev => prev.map(x => x.sipUserId === a.sipUserId ? { ...x, _sel: !x._sel } : x))} style={{ accentColor: '#3b82f6' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: '#e5e7eb' }}>{a.username}</div>
                      <div style={{ fontSize: '11px', color: '#9ca3af' }}>{a.displayName || a.email || '—'}</div>
                    </div>
                  </label>
                ));
              })()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '16px 24px', borderTop: '1px solid #1f2937', background: '#1a2332', flexShrink: 0 }}>
              <button type="button" onClick={() => setAssignDrawerOpen(false)} style={{ padding: '8px 20px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#9ca3af', fontSize: '13px', cursor: 'pointer' }}>取消</button>
              <button type="button" className="primary-btn" onClick={handleAssignSave}>儲存</button>
            </div>
          </div>
        </>
      )}

      {/* 数据校验结果弹窗 */}
      {validateResult && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 2147483647, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={() => setValidateResult(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />
          <div style={{ position: 'relative', background: '#111827', border: '1px solid #4b5563', borderRadius: '14px', padding: '28px 32px', maxWidth: '640px', width: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#f3f4f6', fontWeight: 700 }}>數據校驗結果</h3>
              <button onClick={() => setValidateResult(null)} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: '18px' }}>✕</button>
            </div>
            {validateResult.flexisipError && (
              <div style={{ padding: '10px 14px', marginBottom: '16px', background: '#1a1a0a', border: '1px solid #fbbf24', borderRadius: '8px', color: '#fbbf24', fontSize: '13px' }}>
                Flexisip 连接异常：{validateResult.flexisipError}
              </div>
            )}
            {validateResult.allOk ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#4ade80', fontSize: '15px', fontWeight: 500 }}>
                全部 {validateResult.total} 筆記錄校驗通過，數據一致。
              </div>
            ) : (
              <>
                <div style={{ marginBottom: '12px', color: '#9ca3af', fontSize: '13px' }}>共 {validateResult.total} 筆記錄，發現以下差異：</div>
                <div style={{ flex: 1, overflow: 'auto', maxHeight: '50vh', scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
                  {validateResult.results?.map((r, i) => (
                    <div key={i} style={{ padding: '10px 14px', marginBottom: '8px', borderRadius: '8px', border: '1px solid', background: r.status === 'matched' ? '#0d2818' : r.status === 'local_only' ? '#1e3a5f' : r.status === 'missing_on_flexisip' ? '#3b1111' : '#1e293b', borderColor: r.status === 'matched' ? '#065f46' : r.status === 'local_only' ? '#1e3a5f' : r.status === 'missing_on_flexisip' ? '#7f1d1d' : '#374151', fontSize: '13px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 600, color: '#e5e7eb' }}>{r.name}</span>
                        <span style={{ padding: '1px 8px', borderRadius: '999px', fontSize: '11px', background: r.status === 'matched' ? '#065f46' : r.status === 'local_only' ? '#1e3a5f' : r.status === 'missing_on_flexisip' ? '#7f1d1d' : '#374151', color: r.status === 'matched' ? '#6ee7b7' : r.status === 'local_only' ? '#93c5fd' : r.status === 'missing_on_flexisip' ? '#fca5a5' : '#9ca3af' }}>
                          {r.status === 'matched' ? '一致' : r.status === 'local_only' ? '仅本地' : r.status === 'missing_on_flexisip' ? 'Flexisip缺失' : r.status === 'missing_locally' ? '本地缺失' : r.status}
                        </span>
                      </div>
                      {r.note && <div style={{ color: '#9ca3af', fontSize: '11px' }}>{r.note}</div>}
                    </div>
                  ))}
                </div>
              </>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px', flexShrink: 0 }}>
              <button onClick={() => setValidateResult(null)} style={{ padding: '8px 20px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#9ca3af', fontSize: '13px', cursor: 'pointer' }}>關閉</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
});

export default ContactBooks;
