import React, {
  forwardRef,
  useEffect,
  useState,
  useRef,
  memo,
  useMemo,
  useCallback,
} from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router';

import { Button } from '@actual-app/components/button';
import { SvgSplit } from '@actual-app/components/icons/v0';
import {
  SvgAdd,
  SvgPiggyBank,
  SvgTrash,
} from '@actual-app/components/icons/v1';
import { SvgPencilWriteAlternate } from '@actual-app/components/icons/v2';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { Toggle } from '@actual-app/components/toggle';
import { View } from '@actual-app/components/view';
import {
  format as formatDate,
  parse as parseDate,
  parseISO,
  isValid as isValidDate,
} from 'date-fns';

import { send } from 'loot-core/platform/client/fetch';
import * as monthUtils from 'loot-core/shared/months';
import * as Platform from 'loot-core/shared/platform';
import { q } from 'loot-core/shared/query';
import {
  ungroupTransactions,
  updateTransaction,
  realizeTempTransactions,
  splitTransaction,
  addSplitTransaction,
  deleteTransaction,
  makeChild,
} from 'loot-core/shared/transactions';
import {
  titleFirst,
  integerToCurrency,
  integerToAmount,
  amountToInteger,
  getChangedValues,
  diffItems,
  groupById,
} from 'loot-core/shared/util';

import { FocusableAmountInput } from './FocusableAmountInput';

import { MobileBackButton } from '@desktop-client/components/mobile/MobileBackButton';
import {
  FieldLabel,
  TapField,
  InputField,
  ToggleField,
} from '@desktop-client/components/mobile/MobileForms';
import { getPrettyPayee } from '@desktop-client/components/mobile/utils';
import { MobilePageHeader, Page } from '@desktop-client/components/Page';
import { AmountInput } from '@desktop-client/components/util/AmountInput';
import { useAccounts } from '@desktop-client/hooks/useAccounts';
import { useCategories } from '@desktop-client/hooks/useCategories';
import { useDateFormat } from '@desktop-client/hooks/useDateFormat';
import { useInitialMount } from '@desktop-client/hooks/useInitialMount';
import { useNavigate } from '@desktop-client/hooks/useNavigate';
import { usePayees } from '@desktop-client/hooks/usePayees';
import {
  SingleActiveEditFormProvider,
  useSingleActiveEditForm,
} from '@desktop-client/hooks/useSingleActiveEditForm';
import { pushModal } from '@desktop-client/modals/modalsSlice';
import { aqlQuery } from '@desktop-client/queries/aqlQuery';
import { setLastTransaction } from '@desktop-client/queries/queriesSlice';
import { useSelector, useDispatch } from '@desktop-client/redux';

function getFieldName(transactionId, field) {
  return `${field}-${transactionId}`;
}

function serializeTransaction(transaction, dateFormat) {
  const { date, amount } = transaction;
  return {
    ...transaction,
    date: formatDate(parseISO(date), dateFormat),
    amount: integerToAmount(amount || 0),
  };
}

function deserializeTransaction(transaction, originalTransaction, dateFormat) {
  const { amount, date: originalDate, ...realTransaction } = transaction;

  const dayMonth = monthUtils.getDayMonthRegex(dateFormat);
  let date = originalDate;
  if (dayMonth.test(date)) {
    const test = parseDate(
      date,
      monthUtils.getDayMonthFormat(dateFormat),
      new Date(),
    );
    if (isValidDate(test)) {
      date = monthUtils.dayFromDate(test);
    } else {
      date = null;
    }
  } else {
    const test = parseDate(date, dateFormat, new Date());
    // This is a quick sanity check to make sure something invalid
    // like "year 201" was entered
    if (test.getFullYear() > 2000 && isValidDate(test)) {
      date = monthUtils.dayFromDate(test);
    } else {
      date = null;
    }
  }

  if (date == null) {
    date =
      (originalTransaction && originalTransaction.date) ||
      monthUtils.currentDay();
  }

  return { ...realTransaction, date, amount: amountToInteger(amount || 0) };
}

export function lookupName(items, id) {
  if (!id) {
    return null;
  }
  return items.find(item => item.id === id)?.name;
}

export function Status({ status, isSplit }) {
  const { t } = useTranslation();

  let color;

  switch (status) {
    case 'missed':
      color = theme.errorText;
      break;
    case 'due':
      color = theme.warningText;
      break;
    case 'upcoming':
      color = theme.tableHeaderText;
      break;
    default:
  }

  return (
    <Text
      style={{
        fontSize: 11,
        color,
        fontStyle: 'italic',
        textAlign: 'left',
      }}
    >
      {isSplit
        ? t('{{status}} (Split)', { status: titleFirst(status) })
        : titleFirst(status)}
    </Text>
  );
}

function Footer({
  transactions,
  isAdding,
  onAdd,
  onSave,
  onSplit,
  onAddSplit,
  onEmptySplitFound,
  editingField,
  onEditField,
}) {
  const [transaction, ...childTransactions] = transactions;
  const emptySplitTransaction = childTransactions.find(t => t.amount === 0);
  const onClickRemainingSplit = () => {
    if (childTransactions.length === 0) {
      onSplit(transaction.id);
    } else {
      if (!emptySplitTransaction) {
        onAddSplit(transaction.id);
      } else {
        onEmptySplitFound?.(emptySplitTransaction.id);
      }
    }
  };

  return (
    <View
      data-testid="transaction-form-footer"
      style={{
        paddingLeft: styles.mobileEditingPadding,
        paddingRight: styles.mobileEditingPadding,
        paddingTop: 10,
        paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
        backgroundColor: theme.tableHeaderBackground,
        borderTopWidth: 1,
        borderColor: theme.tableBorder,
      }}
    >
      {transaction.error?.type === 'SplitTransactionError' ? (
        <Button
          variant="primary"
          style={{ height: styles.mobileMinHeight }}
          isDisabled={editingField}
          onPress={onClickRemainingSplit}
        >
          <SvgSplit width={17} height={17} />
          <Text
            style={{
              ...styles.text,
              marginLeft: 6,
            }}
          >
            {!emptySplitTransaction ? (
              <Trans>
                Add new split -{' '}
                {{
                  amount: integerToCurrency(
                    transaction.amount > 0
                      ? transaction.error.difference
                      : -transaction.error.difference,
                  ),
                }}{' '}
                left
              </Trans>
            ) : (
              <Trans>
                Amount left:{' '}
                {{
                  amount: integerToCurrency(
                    transaction.amount > 0
                      ? transaction.error.difference
                      : -transaction.error.difference,
                  ),
                }}
              </Trans>
            )}
          </Text>
        </Button>
      ) : !transaction.account ? (
        <Button
          variant="primary"
          style={{ height: styles.mobileMinHeight }}
          isDisabled={editingField}
          onPress={() => onEditField(transaction.id, 'account')}
        >
          <SvgPiggyBank width={17} height={17} />
          <Text
            style={{
              ...styles.text,
              marginLeft: 6,
            }}
          >
            <Trans>Select account</Trans>
          </Text>
        </Button>
      ) : isAdding ? (
        <Button
          variant="primary"
          style={{ height: styles.mobileMinHeight }}
          isDisabled={editingField}
          onPress={onAdd}
        >
          <SvgAdd width={17} height={17} />
          <Text
            style={{
              ...styles.text,
              marginLeft: 5,
            }}
          >
            <Trans>Add transaction</Trans>
          </Text>
        </Button>
      ) : (
        <Button
          variant="primary"
          style={{ height: styles.mobileMinHeight }}
          isDisabled={editingField}
          onPress={onSave}
        >
          <SvgPencilWriteAlternate width={16} height={16} />
          <Text
            style={{
              ...styles.text,
              marginLeft: 6,
            }}
          >
            <Trans>Save changes</Trans>
          </Text>
        </Button>
      )}
    </View>
  );
}

const ChildTransactionEdit = forwardRef(
  (
    {
      transaction,
      amountFocused,
      amountSign,
      getCategory,
      getPayee,
      getTransferAccount,
      isOffBudget,
      isBudgetTransfer,
      onEditField,
      onUpdate,
      onDelete,
    },
    ref,
  ) => {
    const { t } = useTranslation();
    const { editingField, onRequestActiveEdit, onClearActiveEdit } =
      useSingleActiveEditForm();
    const prettyPayee = getPrettyPayee({
      transaction,
      payee: getPayee(transaction),
      transferAccount: getTransferAccount(transaction),
    });
    return (
      <View
        innerRef={ref}
        style={{
          backgroundColor: theme.tableBackground,
          borderColor:
            transaction.amount === 0
              ? theme.tableBorderSelected
              : theme.tableBorder,
          borderWidth: '1px',
          borderRadius: '5px',
          padding: '5px',
          margin: '10px',
        }}
      >
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flexBasis: '75%' }}>
            <FieldLabel title={t('Payee')} />
            <TapField
              isDisabled={
                editingField &&
                editingField !== getFieldName(transaction.id, 'payee')
              }
              value={prettyPayee}
              onPress={() => onEditField(transaction.id, 'payee')}
              data-testid={`payee-field-${transaction.id}`}
            />
          </View>
          <View
            style={{
              flexBasis: '25%',
            }}
          >
            <FieldLabel title={t('Amount')} style={{ padding: 0 }} />
            <AmountInput
              disabled={
                editingField &&
                editingField !== getFieldName(transaction.id, 'amount')
              }
              focused={amountFocused}
              value={amountToInteger(transaction.amount)}
              zeroSign={amountSign}
              style={{ marginRight: 8 }}
              inputStyle={{
                ...styles.smallText,
                textAlign: 'right',
                minWidth: 0,
              }}
              onFocus={() =>
                onRequestActiveEdit(getFieldName(transaction.id, 'amount'))
              }
              onUpdate={value => {
                const amount = integerToAmount(value);
                if (transaction.amount !== amount) {
                  onUpdate(transaction, 'amount', amount);
                } else {
                  onClearActiveEdit();
                }
              }}
              autoDecimals={true}
            />
          </View>
        </View>

        <View>
          <FieldLabel title={t('Category')} />
          <TapField
            textStyle={{
              ...((isOffBudget || isBudgetTransfer(transaction)) && {
                fontStyle: 'italic',
                color: theme.pageTextSubdued,
                fontWeight: 300,
              }),
            }}
            value={getCategory(transaction, isOffBudget)}
            isDisabled={
              (editingField &&
                editingField !== getFieldName(transaction.id, 'category')) ||
              isOffBudget ||
              isBudgetTransfer(transaction)
            }
            onPress={() => onEditField(transaction.id, 'category')}
            data-testid={`category-field-${transaction.id}`}
          />
        </View>

        <View>
          <FieldLabel title={t('Notes')} />
          <InputField
            disabled={
              editingField &&
              editingField !== getFieldName(transaction.id, 'notes')
            }
            defaultValue={transaction.notes}
            onFocus={() =>
              onRequestActiveEdit(getFieldName(transaction.id, 'notes'))
            }
            onUpdate={value => onUpdate(transaction, 'notes', value)}
          />
        </View>

        <View style={{ alignItems: 'center' }}>
          <Button
            variant="bare"
            onPress={() => onDelete(transaction.id)}
            style={{
              height: 40,
              borderWidth: 0,
              marginLeft: styles.mobileEditingPadding,
              marginRight: styles.mobileEditingPadding,
              marginTop: 10,
              backgroundColor: 'transparent',
            }}
          >
            <SvgTrash
              width={17}
              height={17}
              style={{ color: theme.errorText }}
            />
            <Text
              style={{
                color: theme.errorText,
                marginLeft: 5,
                userSelect: 'none',
              }}
            >
              <Trans>Delete split</Trans>
            </Text>
          </Button>
        </View>
      </View>
    );
  },
);

ChildTransactionEdit.displayName = 'ChildTransactionEdit';

const TransactionEditInner = memo(function TransactionEditInner({
  isAdding,
  accounts,
  categories,
  payees,
  dateFormat,
  transactions: unserializedTransactions,
  onSave,
  onUpdate,
  onDelete,
  onSplit,
  onAddSplit,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const transactions = useMemo(
    () =>
      unserializedTransactions.map(t => serializeTransaction(t, dateFormat)) ||
      [],
    [unserializedTransactions, dateFormat],
  );
  const { grouped: categoryGroups } = useCategories();

  useEffect(() => {
    if (window.history.length === 1) {
      window.history.replaceState(null, 'Actual Budget', '/');
      window.history.pushState(null, 'Add Transaction', '/transactions/new');
    }
  }, []);

  const [transaction, ...childTransactions] = transactions;

  const { editingField, onRequestActiveEdit, onClearActiveEdit } =
    useSingleActiveEditForm();
  const [totalAmountFocused, setTotalAmountFocused] = useState(
    // iOS does not support automatically opening up the keyboard for the
    // total amount field. Hence we should not focus on it on page render.
    !Platform.isIOSAgent,
  );
  const childTransactionElementRefMap = useRef({});
  const hasAccountChanged = useRef(false);

  const payeesById = useMemo(() => groupById(payees), [payees]);
  const accountsById = useMemo(() => groupById(accounts), [accounts]);

  const onTotalAmountEdit = useCallback(() => {
    onRequestActiveEdit?.(getFieldName(transaction.id, 'amount'), () => {
      setTotalAmountFocused(true);
      return () => setTotalAmountFocused(false);
    });
  }, [onRequestActiveEdit, transaction.id]);

  const isInitialMount = useInitialMount();

  useEffect(() => {
    if (isInitialMount && isAdding && !Platform.isIOSAgent) {
      onTotalAmountEdit();
    }
  }, [isAdding, isInitialMount, onTotalAmountEdit]);

  const getAccount = useCallback(
    trans => {
      return trans?.account && accountsById?.[trans.account];
    },
    [accountsById],
  );

  const getPayee = useCallback(
    trans => {
      return trans?.payee && payeesById?.[trans.payee];
    },
    [payeesById],
  );

  const getTransferAccount = useCallback(
    trans => {
      const payee = trans && getPayee(trans);
      return payee?.transfer_acct && accountsById?.[payee.transfer_acct];
    },
    [accountsById, getPayee],
  );

  const isBudgetTransfer = useCallback(
    trans => {
      const transferAcct = trans && getTransferAccount(trans);
      return transferAcct && !transferAcct.offbudget;
    },
    [getTransferAccount],
  );

  const getCategory = useCallback(
    (trans, isOffBudget) => {
      if (isOffBudget) {
        return 'Off budget';
      } else if (isBudgetTransfer(trans)) {
        return 'Transfer';
      } else {
        return lookupName(categories, trans.category);
      }
    },
    [categories, isBudgetTransfer],
  );

  const onSaveInner = useCallback(() => {
    const [unserializedTransaction] = unserializedTransactions;

    const onConfirmSave = () => {
      let transactionsToSave = unserializedTransactions;
      if (isAdding) {
        transactionsToSave = realizeTempTransactions(unserializedTransactions);
      }

      onSave(transactionsToSave);
      navigate(-1);
    };

    if (unserializedTransaction.reconciled) {
      // On mobile any save gives the warning.
      // On the web only certain changes trigger a warning.
      // Should we bring that here as well? Or does the nature of the editing form
      // make this more appropriate?
      dispatch(
        pushModal({
          modal: {
            name: 'confirm-transaction-edit',
            options: {
              onConfirm: onConfirmSave,
              confirmReason: 'editReconciled',
            },
          },
        }),
      );
    } else {
      onConfirmSave();
    }
  }, [isAdding, dispatch, navigate, onSave, unserializedTransactions]);

  const onUpdateInner = useCallback(
    async (serializedTransaction, name, value) => {
      const newTransaction = { ...serializedTransaction, [name]: value };
      await onUpdate(newTransaction, name);
      onClearActiveEdit();

      if (name === 'account') {
        hasAccountChanged.current = serializedTransaction.account !== value;
      }
    },
    [onClearActiveEdit, onUpdate],
  );

  const onTotalAmountUpdate = useCallback(
    value => {
      if (transaction.amount !== value) {
        onUpdateInner(transaction, 'amount', value.toString());
      }
    },
    [onUpdateInner, transaction],
  );

  const onEditFieldInner = useCallback(
    (transactionId, name) => {
      onRequestActiveEdit?.(getFieldName(transaction.id, name), () => {
        const transactionToEdit = transactions.find(
          t => t.id === transactionId,
        );
        const unserializedTransaction = unserializedTransactions.find(
          t => t.id === transactionId,
        );
        switch (name) {
          case 'category':
            dispatch(
              pushModal({
                modal: {
                  name: 'category-autocomplete',
                  options: {
                    categoryGroups,
                    month: monthUtils.monthFromDate(
                      unserializedTransaction.date,
                    ),
                    onSelect: categoryId => {
                      onUpdateInner(transactionToEdit, name, categoryId);
                    },
                    onClose: () => {
                      onClearActiveEdit();
                    },
                  },
                },
              }),
            );
            break;
          case 'account':
            dispatch(
              pushModal({
                modal: {
                  name: 'account-autocomplete',
                  options: {
                    onSelect: accountId => {
                      onUpdateInner(transactionToEdit, name, accountId);
                    },
                    onClose: () => {
                      onClearActiveEdit();
                    },
                  },
                },
              }),
            );
            break;
          case 'payee':
            dispatch(
              pushModal({
                modal: {
                  name: 'payee-autocomplete',
                  options: {
                    onSelect: payeeId => {
                      onUpdateInner(transactionToEdit, name, payeeId);
                    },
                    onClose: () => {
                      onClearActiveEdit();
                    },
                  },
                },
              }),
            );
            break;
          default:
            dispatch(
              pushModal({
                modal: {
                  name: 'edit-field',
                  options: {
                    name,
                    month: monthUtils.monthFromDate(
                      unserializedTransaction.date,
                    ),
                    onSubmit: (name, value) => {
                      onUpdateInner(transactionToEdit, name, value);
                    },
                    onClose: () => {
                      onClearActiveEdit();
                    },
                  },
                },
              }),
            );
            break;
        }
      });
    },
    [
      categoryGroups,
      dispatch,
      onUpdateInner,
      onClearActiveEdit,
      onRequestActiveEdit,
      transaction.id,
      transactions,
      unserializedTransactions,
    ],
  );

  const onDeleteInner = useCallback(
    id => {
      const [unserializedTransaction] = unserializedTransactions;

      const onConfirmDelete = () => {
        dispatch(
          pushModal({
            modal: {
              name: 'confirm-transaction-delete',
              options: {
                onConfirm: () => {
                  onDelete(id);

                  if (unserializedTransaction.id !== id) {
                    // Only a child transaction was deleted.
                    onClearActiveEdit();
                    return;
                  }

                  navigate(-1);
                },
              },
            },
          }),
        );
      };

      if (unserializedTransaction.reconciled) {
        dispatch(
          pushModal({
            modal: {
              name: 'confirm-transaction-edit',
              options: {
                onConfirm: onConfirmDelete,
                confirmReason: 'deleteReconciled',
              },
            },
          }),
        );
      } else {
        onConfirmDelete();
      }
    },
    [dispatch, navigate, onClearActiveEdit, onDelete, unserializedTransactions],
  );

  const scrollChildTransactionIntoView = useCallback(id => {
    const childTransactionEditElement =
      childTransactionElementRefMap.current?.[id];
    childTransactionEditElement?.scrollIntoView({
      behavior: 'smooth',
    });
  }, []);

  const onEmptySplitFound = useCallback(
    id => {
      scrollChildTransactionIntoView(id);
    },
    [scrollChildTransactionIntoView],
  );

  useEffect(() => {
    const noAmountChildTransaction = childTransactions.find(
      t => t.amount === 0,
    );
    if (noAmountChildTransaction) {
      scrollChildTransactionIntoView(noAmountChildTransaction.id);
    }
  }, [childTransactions, scrollChildTransactionIntoView]);

  // Child transactions should always default to the signage
  // of the parent transaction
  const childAmountSign = transaction.amount <= 0 ? '-' : '+';

  const account = getAccount(transaction);
  const isOffBudget = account && !!account.offbudget;
  const title = getPrettyPayee({
    transaction,
    payee: getPayee(transaction),
    transferAccount: getTransferAccount(transaction),
  });

  const transactionDate = parseDate(transaction.date, dateFormat, new Date());
  const dateDefaultValue = monthUtils.dayFromDate(transactionDate);

  return (
    <Page
      header={
        <MobilePageHeader
          title={
            transaction.payee == null
              ? isAdding
                ? t('New Transaction')
                : t('Transaction')
              : title
          }
          leftContent={<MobileBackButton />}
        />
      }
      titleStyle={{
        fontSize: 16,
        fontWeight: 500,
      }}
      footer={
        <Footer
          transactions={transactions}
          isAdding={isAdding}
          onAdd={onSaveInner}
          onSave={onSaveInner}
          onSplit={onSplit}
          onAddSplit={onAddSplit}
          onEmptySplitFound={onEmptySplitFound}
          editingField={editingField}
          onEditField={onEditFieldInner}
        />
      }
      padding={0}
    >
      <View
        data-testid="transaction-form"
        style={{ flexShrink: 0, marginTop: 20, marginBottom: 20 }}
      >
        <View
          style={{
            alignItems: 'center',
          }}
        >
          <FieldLabel title={t('Amount')} flush style={{ marginBottom: 0 }} />
          <FocusableAmountInput
            value={transaction.amount}
            zeroSign="-"
            focused={totalAmountFocused}
            onFocus={onTotalAmountEdit}
            onBlur={onClearActiveEdit}
            onUpdateAmount={onTotalAmountUpdate}
            focusedStyle={{
              width: 'auto',
              padding: '5px',
              paddingLeft: '20px',
              paddingRight: '20px',
              minWidth: '100%',
            }}
            textStyle={{ ...styles.veryLargeText, textAlign: 'center' }}
          />
        </View>

        <View>
          <FieldLabel title={t('Payee')} />
          <TapField
            textStyle={{
              ...(transaction.is_parent && {
                fontStyle: 'italic',
                fontWeight: 300,
              }),
            }}
            value={title}
            isDisabled={
              editingField &&
              editingField !== getFieldName(transaction.id, 'payee')
            }
            onPress={() => onEditFieldInner(transaction.id, 'payee')}
            data-testid="payee-field"
          />
        </View>

        {!transaction.is_parent && (
          <View>
            <FieldLabel title={t('Category')} />
            <TapField
              style={{
                ...((isOffBudget || isBudgetTransfer(transaction)) && {
                  fontStyle: 'italic',
                  color: theme.pageTextSubdued,
                  fontWeight: 300,
                }),
              }}
              value={getCategory(transaction, isOffBudget)}
              isDisabled={
                (editingField &&
                  editingField !== getFieldName(transaction.id, 'category')) ||
                isOffBudget ||
                isBudgetTransfer(transaction)
              }
              onPress={() => onEditFieldInner(transaction.id, 'category')}
              data-testid="category-field"
            />
          </View>
        )}

        {childTransactions.map((childTrans, i, arr) => (
          <ChildTransactionEdit
            key={childTrans.id}
            transaction={childTrans}
            amountFocused={arr.findIndex(c => c.amount === 0) === i}
            amountSign={childAmountSign}
            ref={r => {
              childTransactionElementRefMap.current = {
                ...childTransactionElementRefMap.current,
                [childTrans.id]: r,
              };
            }}
            isOffBudget={isOffBudget}
            getCategory={getCategory}
            getPayee={getPayee}
            getTransferAccount={getTransferAccount}
            isBudgetTransfer={isBudgetTransfer}
            onUpdate={onUpdateInner}
            onEditField={onEditFieldInner}
            onDelete={onDeleteInner}
          />
        ))}

        {transaction.amount !== 0 && childTransactions.length === 0 && (
          <View style={{ alignItems: 'center' }}>
            <Button
              variant="bare"
              isDisabled={editingField}
              style={{
                height: 40,
                borderWidth: 0,
                marginLeft: styles.mobileEditingPadding,
                marginRight: styles.mobileEditingPadding,
                marginTop: 10,
                backgroundColor: 'transparent',
              }}
              onPress={() => onSplit(transaction.id)}
            >
              <SvgSplit
                width={17}
                height={17}
                style={{ color: theme.formLabelText }}
              />
              <Text
                style={{
                  marginLeft: 5,
                  userSelect: 'none',
                  color: theme.formLabelText,
                }}
              >
                <Trans>Split</Trans>
              </Text>
            </Button>
          </View>
        )}

        <View>
          <FieldLabel title={t('Account')} />
          <TapField
            isDisabled={
              editingField &&
              editingField !== getFieldName(transaction.id, 'account')
            }
            value={account?.name}
            onPress={() => onEditFieldInner(transaction.id, 'account')}
            data-testid="account-field"
          />
        </View>

        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1 }}>
            <FieldLabel title={t('Date')} />
            <InputField
              type="date"
              disabled={
                editingField &&
                editingField !== getFieldName(transaction.id, 'date')
              }
              required
              style={{ color: theme.tableText, minWidth: '150px' }}
              defaultValue={dateDefaultValue}
              onFocus={() =>
                onRequestActiveEdit(getFieldName(transaction.id, 'date'))
              }
              onChange={event =>
                onUpdateInner(
                  transaction,
                  'date',
                  formatDate(parseISO(event.target.value), dateFormat),
                )
              }
            />
          </View>
          {transaction.reconciled ? (
            <View style={{ alignItems: 'center' }}>
              <FieldLabel title={t('Reconciled')} />
              <Toggle id="Reconciled" isOn isDisabled />
            </View>
          ) : (
            <View style={{ alignItems: 'center' }}>
              <FieldLabel title={t('Cleared')} />
              <ToggleField
                id="cleared"
                isOn={transaction.cleared}
                onToggle={on => onUpdateInner(transaction, 'cleared', on)}
              />
            </View>
          )}
        </View>

        <View>
          <FieldLabel title={t('Notes')} />
          <InputField
            disabled={
              editingField &&
              editingField !== getFieldName(transaction.id, 'notes')
            }
            defaultValue={transaction.notes}
            onFocus={() => {
              onRequestActiveEdit(getFieldName(transaction.id, 'notes'));
            }}
            onBlur={onClearActiveEdit}
            onChange={event =>
              onUpdateInner(transaction, 'notes', event.target.value)
            }
          />
        </View>

        {!isAdding && (
          <View style={{ alignItems: 'center' }}>
            <Button
              variant="bare"
              onPress={() => onDeleteInner(transaction.id)}
              style={{
                height: 40,
                borderWidth: 0,
                marginLeft: styles.mobileEditingPadding,
                marginRight: styles.mobileEditingPadding,
                marginTop: 10,
                backgroundColor: 'transparent',
              }}
            >
              <SvgTrash
                width={17}
                height={17}
                style={{ color: theme.errorText }}
              />
              <Text
                style={{
                  color: theme.errorText,
                  marginLeft: 5,
                  userSelect: 'none',
                }}
              >
                <Trans>Delete transaction</Trans>
              </Text>
            </Button>
          </View>
        )}
      </View>
    </Page>
  );
});

function isTemporary(transaction) {
  return transaction.id.indexOf('temp') === 0;
}

function makeTemporaryTransactions(accountId, categoryId, lastDate) {
  return [
    {
      id: 'temp',
      date: lastDate || monthUtils.currentDay(),
      account: accountId,
      category: categoryId,
      amount: 0,
      cleared: false,
    },
  ];
}

function TransactionEditUnconnected({
  categories,
  accounts,
  payees,
  lastTransaction,
  dateFormat,
}) {
  const { transactionId } = useParams();
  const { state: locationState } = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [transactions, setTransactions] = useState([]);
  const [fetchedTransactions, setFetchedTransactions] = useState([]);
  const isAdding = useRef(false);
  const isDeleted = useRef(false);

  useEffect(() => {
    let unmounted = false;

    async function fetchTransaction() {
      // Query for the transaction based on the ID with grouped splits.
      //
      // This means if the transaction in question is a split transaction, its
      // subtransactions will be returned in the `substransactions` property on
      // the parent transaction.
      //
      // The edit item components expect to work with a flat array of
      // transactions when handling splits, so we call ungroupTransactions to
      // flatten parent and children into one array.
      const { data } = await aqlQuery(
        q('transactions')
          .filter({ id: transactionId })
          .select('*')
          .options({ splits: 'grouped' }),
      );

      if (!unmounted) {
        const fetchedTransactions = ungroupTransactions(data);
        setTransactions(fetchedTransactions);
        setFetchedTransactions(fetchedTransactions);
      }
    }
    if (transactionId !== 'new') {
      fetchTransaction();
    } else {
      isAdding.current = true;
    }

    return () => {
      unmounted = true;
    };
  }, [transactionId]);

  useEffect(() => {
    if (isAdding.current) {
      setTransactions(
        makeTemporaryTransactions(
          locationState?.accountId || lastTransaction?.account || null,
          locationState?.categoryId || null,
          lastTransaction?.date,
        ),
      );
    }
  }, [locationState?.accountId, locationState?.categoryId, lastTransaction]);

  const onUpdate = useCallback(
    async (serializedTransaction, updatedField) => {
      const transaction = deserializeTransaction(
        serializedTransaction,
        null,
        dateFormat,
      );

      // Run the rules to auto-fill in any data. Right now we only do
      // this on new transactions because that's how desktop works.
      const newTransaction = { ...transaction };
      if (isTemporary(newTransaction)) {
        const afterRules = await send('rules-run', {
          transaction: newTransaction,
        });
        const diff = getChangedValues(newTransaction, afterRules);

        if (diff) {
          Object.keys(diff).forEach(field => {
            if (
              newTransaction[field] == null ||
              newTransaction[field] === '' ||
              newTransaction[field] === 0 ||
              newTransaction[field] === false
            ) {
              newTransaction[field] = diff[field];
            }
          });

          // When a rule updates a parent transaction, overwrite all changes to the current field in subtransactions.
          if (
            newTransaction.is_parent &&
            diff.subtransactions !== undefined &&
            updatedField !== null
          ) {
            newTransaction.subtransactions = diff.subtransactions.map(
              (st, idx) => ({
                ...(newTransaction.subtransactions[idx] || st),
                ...(st[updatedField] != null && {
                  [updatedField]: st[updatedField],
                }),
              }),
            );
          }
        }
      }

      const { data: newTransactions } = updateTransaction(
        transactions,
        newTransaction,
      );
      setTransactions(newTransactions);
    },
    [dateFormat, transactions],
  );

  const onSave = useCallback(
    async newTransactions => {
      if (isDeleted.current) {
        return;
      }

      const changes = diffItems(fetchedTransactions || [], newTransactions);
      if (
        changes.added.length > 0 ||
        changes.updated.length > 0 ||
        changes.deleted.length
      ) {
        const _remoteUpdates = await send('transactions-batch-update', {
          added: changes.added,
          deleted: changes.deleted,
          updated: changes.updated,
        });

        // if (onTransactionsChange) {
        //   onTransactionsChange({
        //     ...changes,
        //     updated: changes.updated.concat(remoteUpdates),
        //   });
        // }
      }

      if (isAdding.current) {
        // The first one is always the "parent" and the only one we care
        // about
        dispatch(setLastTransaction({ transaction: newTransactions[0] }));
      }
    },
    [dispatch, fetchedTransactions],
  );

  const onDelete = useCallback(
    async id => {
      const changes = deleteTransaction(transactions, id);

      if (isAdding.current) {
        // Adding a new transactions, this disables saving when the component unmounts
        isDeleted.current = true;
      } else {
        const _remoteUpdates = await send('transactions-batch-update', {
          deleted: changes.diff.deleted,
        });

        // if (onTransactionsChange) {
        //   onTransactionsChange({ ...changes, updated: remoteUpdates });
        // }
      }

      setTransactions(changes.data);
    },
    [transactions],
  );

  const onAddSplit = useCallback(
    id => {
      const changes = addSplitTransaction(transactions, id);
      setTransactions(changes.data);
    },
    [transactions],
  );

  const onSplit = useCallback(
    id => {
      const changes = splitTransaction(transactions, id, parent => [
        makeChild(parent),
        makeChild(parent),
      ]);

      setTransactions(changes.data);
    },
    [transactions],
  );

  if (
    categories.length === 0 ||
    accounts.length === 0 ||
    transactions.length === 0
  ) {
    return null;
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.pageBackground,
      }}
    >
      <TransactionEditInner
        transactions={transactions}
        isAdding={isAdding.current}
        categories={categories}
        accounts={accounts}
        payees={payees}
        navigate={navigate}
        dateFormat={dateFormat}
        onUpdate={onUpdate}
        onSave={onSave}
        onDelete={onDelete}
        onSplit={onSplit}
        onAddSplit={onAddSplit}
      />
    </View>
  );
}

export const TransactionEdit = props => {
  const { list: categories } = useCategories();
  const payees = usePayees();
  const lastTransaction = useSelector(state => state.queries.lastTransaction);
  const accounts = useAccounts();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';

  return (
    <SingleActiveEditFormProvider formName="mobile-transaction">
      <TransactionEditUnconnected
        {...props}
        categories={categories}
        payees={payees}
        lastTransaction={lastTransaction}
        accounts={accounts}
        dateFormat={dateFormat}
      />
    </SingleActiveEditFormProvider>
  );
};
